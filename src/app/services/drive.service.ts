import { Injectable, inject } from '@angular/core';
import { GoogleAuthService } from './google-auth.service';
import { OfflineService } from './offline.service';
import { Book, Chapter } from '../models';
import { chapterTitle, naturalCompare, newId, parseFolderTitle } from '../util/format';
import { buildFileChapters } from '../util/chapters';
import { Mp4Meta, readMp4Meta } from '../util/mp4';
import { ProgressFn, readWithProgress } from '../util/stream';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const AUDIO_EXT = /\.(mp3|m4a|m4b|mp4|aac|wav|ogg|oga|flac|opus|wma)$/i;
/** Containers worth opening to look for chapter markers and tags. */
const MP4_EXT = /\.(m4b|m4a|mp4)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
/** Filenames that look like they were put there to be the cover. */
const COVER_HINT = /(cover|folder|front|art|album|book)/i;

/**
 * Drive hands back `application/octet-stream` for .m4b often enough that the
 * browser refuses to play the blob. Re-labelling by extension fixes it.
 */
const PLAY_MIME: Record<string, string> = {
  m4b: 'audio/mp4',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
};

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
}

/** A Drive folder, for the in-app folder browser. */
export interface DriveFolder {
  id: string;
  name: string;
}


@Injectable({ providedIn: 'root' })
export class DriveService {
  private auth = inject(GoogleAuthService);
  private offline = inject(OfflineService);

  /** Accept a raw folder id OR any Drive folder/share URL and dig out the id. */
  parseFolderId(input: string): string {
    const s = (input || '').trim();
    const byPath = s.match(/folders\/([a-zA-Z0-9_-]{10,})/);
    if (byPath) return byPath[1];
    const byOpen = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (byOpen) return byOpen[1];
    const byFile = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (byFile) return byFile[1];
    return s;
  }

  /**
   * The Google sign-in popup can only open in response to a user gesture, so
   * only escalate to it when the user just interacted (playing a book, adding a
   * folder). Background work — startup sync, read-ahead — fails quietly instead
   * of firing a popup the browser would block anyway.
   */
  private get canPromptInteractive(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!(navigator as unknown as { userActivation?: { isActive: boolean } })
        .userActivation?.isActive
    );
  }

  // ── low-level API ────────────────────────────────────────────────────────
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const call = (t: string) =>
      fetch(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` },
      });

    let token: string;
    try {
      token = await this.auth.getValidToken();
    } catch (err) {
      // Silent refresh failed and no token is held. Re-auth interactively only
      // if the user just did something; otherwise let the caller fail quietly.
      if (!this.canPromptInteractive) throw err;
      token = await this.auth.signIn(true);
    }

    let res = await call(token);
    if (res.status === 401 && this.canPromptInteractive) {
      // Token rejected mid-session — one interactive refresh, then retry once.
      token = await this.auth.signIn(true);
      res = await call(token);
    }
    return res;
  }

  private async apiJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.request(url, init);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Drive API ${res.status}: ${body.slice(0, 240)}`);
    }
    return res.json() as Promise<T>;
  }

  private isFolder(f: DriveFile): boolean {
    return f.mimeType === FOLDER_MIME;
  }

  private isAudio(f: DriveFile): boolean {
    const mime = f.mimeType ?? '';
    // .m4b and .mp4 arrive as video/mp4 or octet-stream, so the extension has
    // the final say — but a bare video/* with no audio extension stays out.
    return mime.startsWith('audio/') || mime === 'video/mp4' || AUDIO_EXT.test(f.name || '');
  }

  private extension(name: string): string {
    return (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toLowerCase();
  }

  private isImage(f: DriveFile): boolean {
    return (
      (typeof f.mimeType === 'string' && f.mimeType.startsWith('image/')) ||
      IMAGE_EXT.test(f.name || '')
    );
  }

  /** Every child of a folder, following pagination. */
  private async listChildren(folderId: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
        pageSize: '1000',
        orderBy: 'folder, name_natural',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await this.apiJson(`${DRIVE_FILES}?${params}`);
      out.push(...((data.files ?? []) as DriveFile[]));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  // ── browsing (the in-app folder explorer) ────────────────────────────────
  /**
   * List a folder's subfolders and count the audio inside it, for the folder
   * picker. One listing answers both "where can I go next" (the subfolders)
   * and "is there a book here" (the audio count).
   */
  async browseChildren(
    folderId: string
  ): Promise<{ folders: DriveFolder[]; audioCount: number }> {
    const children = await this.listChildren(folderId);
    const folders = children
      .filter((f) => this.isFolder(f))
      .map((f) => ({ id: f.id, name: f.name }))
      .sort((a, b) => naturalCompare(a.name, b.name));
    const audioCount = children.filter((f) => this.isAudio(f)).length;
    return { folders, audioCount };
  }

  /** Top-level folders that other people have shared with you. */
  async browseSharedWithMe(): Promise<DriveFolder[]> {
    const params = new URLSearchParams({
      q: "sharedWithMe = true and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id, name)',
      pageSize: '200',
      orderBy: 'name_natural',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    const data = await this.apiJson(`${DRIVE_FILES}?${params}`);
    return ((data.files ?? []) as DriveFile[])
      .map((f) => ({ id: f.id, name: f.name }))
      .sort((a, b) => naturalCompare(a.name, b.name));
  }

  /** Metadata for any Drive item. */
  private async getMeta(id: string): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields: 'id, name, mimeType, size',
      supportsAllDrives: 'true',
    });
    return this.apiJson<DriveFile>(`${DRIVE_FILES}/${id}?${params}`);
  }

  /** Folder metadata — mainly so we can name a book after its folder. */
  async getFolderName(folderId: string): Promise<string> {
    const f = await this.getMeta(folderId);
    if (f.mimeType !== FOLDER_MIME) {
      throw new Error('That link points at a file, not a folder.');
    }
    return f.name;
  }

  /** Whether a pasted link points at a folder or straight at a file. */
  async isFolderId(id: string): Promise<boolean> {
    return (await this.getMeta(id)).mimeType === FOLDER_MIME;
  }

  /**
   * Read a byte range of a file. Drive honours `Range` on the media endpoint,
   * which is what lets us read an .m4b's chapter table without pulling down
   * the whole audiobook. A stowed copy short-circuits the network entirely.
   */
  async readRange(
    fileId: string,
    start: number,
    endInclusive: number
  ): Promise<Uint8Array> {
    const cached = await this.offline.getBlob(fileId);
    if (cached) {
      const slice = cached.slice(start, endInclusive + 1);
      return new Uint8Array(await slice.arrayBuffer());
    }

    const res = await this.request(
      `${DRIVE_FILES}/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Range: `bytes=${start}-${endInclusive}` } }
    );
    if (!res.ok) throw new Error(`Range read failed (${res.status}).`);

    const bytes = new Uint8Array(await res.arrayBuffer());
    // A server that ignores Range answers 200 with the whole file; slice it
    // ourselves so the caller's offsets still mean what it thinks they mean.
    if (res.status === 200 && bytes.length > endInclusive - start + 1) {
      return bytes.subarray(start, endInclusive + 1);
    }
    return bytes;
  }

  // ── books ────────────────────────────────────────────────────────────────
  /**
   * Read one folder as a book. Audio files become chapters in natural filename
   * order; a likely cover image is picked up if the folder has one. Nested
   * subfolders (Disc 1 / Disc 2) are flattened in order so multi-part rips
   * still read as a single spine.
   */
  async scanBook(folderId: string): Promise<Book> {
    const folderName = await this.getFolderName(folderId);
    const { files, cover } = await this.collectAudio(folderId);

    if (!files.length) {
      throw new Error('No audio files in that folder — nothing to listen to.');
    }

    const chapters: Chapter[] = files.map((f, i) => ({
      id: f.id,
      fileId: f.id,
      name: f.name,
      title: chapterTitle(f.name),
      index: i,
      mimeType: f.mimeType,
      size: f.size ? Number(f.size) : undefined,
    }));

    const parsed = parseFolderTitle(folderName);
    return {
      id: folderId,
      kind: 'folder',
      title: parsed.title || folderName,
      folderName,
      author: parsed.author,
      chapters,
      coverFileId: cover,
      addedAt: Date.now(),
      refreshedAt: Date.now(),
      tags: [],
    };
  }

  // ── single-file books (.m4b and friends) ─────────────────────────────────
  /**
   * Read one audio file as a complete book. For an .m4b/.mp4 we open the
   * container and use its embedded chapter markers, title, author and cover;
   * anything else becomes a one-chapter book named after the file.
   */
  async scanFileAsBook(fileOrId: DriveFile | string): Promise<Book> {
    const file =
      typeof fileOrId === 'string' ? await this.getMeta(fileOrId) : fileOrId;
    if (!this.isAudio(file)) {
      throw new Error(`"${file.name}" is not an audio file.`);
    }

    const size = file.size ? Number(file.size) : 0;
    const meta = MP4_EXT.test(file.name) ? await this.tryReadMp4(file.id, size) : null;
    if (meta?.coverDataUrl) this.embeddedCovers.set(file.id, meta.coverDataUrl);

    const fallbackTitle = file.name.replace(/\.[a-z0-9]{1,5}$/i, '');
    const parsed = parseFolderTitle(fallbackTitle);

    return {
      id: file.id,
      kind: 'file',
      title: meta?.title || meta?.album || parsed.title || fallbackTitle,
      folderName: file.name,
      author: meta?.author || parsed.author,
      chapters: buildFileChapters(file.id, file.name, file.mimeType, size || undefined, meta),
      embeddedChapters: (meta?.chapters.length ?? 0) > 0,
      addedAt: Date.now(),
      refreshedAt: Date.now(),
      tags: [],
    };
  }

  /** Chapter parsing is a bonus: a file that won't open is still a book. */
  private async tryReadMp4(fileId: string, size: number): Promise<Mp4Meta | null> {
    if (size <= 0) return null;
    try {
      return await readMp4Meta(
        (start, end) => this.readRange(fileId, start, Math.min(end, size - 1)),
        size
      );
    } catch {
      return null;
    }
  }

  /**
   * Read a folder as a shelf of single-file books: every audio file inside
   * becomes its own book, and subfolders are descended into so a library laid
   * out one-folder-per-title still comes across whole.
   */
  async scanFolderAsFileBooks(
    folderId: string,
    onProgress?: (done: number, total: number, name: string) => void
  ): Promise<Book[]> {
    const files = await this.collectAudioFlat(folderId);
    if (!files.length) {
      throw new Error('No audio files in that folder — nothing to listen to.');
    }

    const books: Book[] = [];
    for (let i = 0; i < files.length; i++) {
      onProgress?.(i, files.length, files[i].name);
      try {
        books.push(await this.scanFileAsBook(files[i]));
      } catch {
        /* one unreadable file shouldn't sink the whole haul */
      }
    }
    onProgress?.(files.length, files.length, '');
    if (!books.length) throw new Error('None of those files could be opened.');
    return books;
  }

  /**
   * Just the audio files in a folder tree — ids and names, nothing opened.
   * Cheap enough to run on every pull-to-refresh, unlike a full scan.
   */
  async listAudioFiles(folderId: string): Promise<{ id: string; name: string }[]> {
    return (await this.collectAudioFlat(folderId)).map((f) => ({
      id: f.id,
      name: f.name,
    }));
  }

  /** Every audio file in a folder tree, in natural order, folders first. */
  private async collectAudioFlat(
    folderId: string,
    depth = 0
  ): Promise<DriveFile[]> {
    const children = await this.listChildren(folderId);
    const out = children
      .filter((f) => this.isAudio(f))
      .sort((a, b) => naturalCompare(a.name, b.name));

    if (depth < 3) {
      const subs = children
        .filter((f) => this.isFolder(f))
        .sort((a, b) => naturalCompare(a.name, b.name));
      for (const sub of subs) {
        out.push(...(await this.collectAudioFlat(sub.id, depth + 1)));
      }
    }
    return out;
  }

  /**
   * Gather audio from a folder and (in order) its subfolders, so "Disc 1",
   * "Disc 2" flatten into one chapter list. Depth is capped — an audiobook
   * folder that goes four levels deep is a mis-pasted Drive root, not a book.
   */
  private async collectAudio(
    folderId: string,
    depth = 0
  ): Promise<{ files: DriveFile[]; cover?: string }> {
    const children = await this.listChildren(folderId);
    const audio = children.filter((f) => this.isAudio(f));
    audio.sort((a, b) => naturalCompare(a.name, b.name));

    const images = children.filter((f) => this.isImage(f));
    const cover =
      images.find((f) => COVER_HINT.test(f.name))?.id ?? images[0]?.id;

    const files = [...audio];
    if (depth < 3) {
      const subs = children
        .filter((f) => this.isFolder(f))
        .sort((a, b) => naturalCompare(a.name, b.name));
      for (const sub of subs) {
        const child = await this.collectAudio(sub.id, depth + 1);
        files.push(...child.files);
      }
    }
    return { files, cover };
  }

  /**
   * Read a shelf folder: every subfolder that contains audio becomes a book.
   * If the folder itself holds audio, it is treated as a single book instead —
   * so users can paste either kind of link and get the sensible thing.
   */
  async scanShelf(
    folderId: string,
    onProgress?: (done: number, total: number, name: string) => void
  ): Promise<Book[]> {
    const children = await this.listChildren(folderId);
    const ownAudio = children.filter((f) => this.isAudio(f));
    if (ownAudio.length) {
      return [await this.scanBook(folderId)];
    }

    const subs = children
      .filter((f) => this.isFolder(f))
      .sort((a, b) => naturalCompare(a.name, b.name));
    if (!subs.length) {
      throw new Error('That folder has neither audio files nor subfolders.');
    }

    const books: Book[] = [];
    for (let i = 0; i < subs.length; i++) {
      onProgress?.(i, subs.length, subs[i].name);
      try {
        books.push(await this.scanBook(subs[i].id));
      } catch {
        /* a subfolder with no audio isn't a book — skip it quietly */
      }
    }
    onProgress?.(subs.length, subs.length, '');
    if (!books.length) {
      throw new Error('None of those subfolders contained audio files.');
    }
    return books;
  }

  /**
   * Cover art lifted out of an .m4b during a scan, waiting to be claimed.
   * It's kept off the `Book` on purpose: a base64 image has no business
   * riding along in the Drive sync payload.
   */
  private embeddedCovers = new Map<string, string>();

  /** Claim (and forget) the cover found inside a file during its scan. */
  takeEmbeddedCover(bookId: string): string | undefined {
    const url = this.embeddedCovers.get(bookId);
    this.embeddedCovers.delete(bookId);
    return url;
  }

  /** Re-read a book from Drive, keeping the user's edits (title, author, tags). */
  async refreshBook(book: Book): Promise<Book> {
    const fresh =
      book.kind === 'file'
        ? await this.scanFileAsBook(book.id)
        : await this.scanBook(book.id);
    return {
      ...fresh,
      title: book.title,
      author: book.author,
      tags: book.tags,
      addedAt: book.addedAt,
      // Keep a hand-picked cover if the user had one and Drive found none.
      coverFileId: fresh.coverFileId ?? book.coverFileId,
      refreshedAt: Date.now(),
    };
  }

  // ── media ────────────────────────────────────────────────────────────────
  /**
   * Private Drive files can't be an `<audio src>` (they need an auth header),
   * so we pull the bytes and hand back an object URL. A stowed offline copy
   * wins, which is what makes downloaded books play with no signal at sea.
   */
  async getObjectUrl(fileId: string, fileName = ''): Promise<string> {
    return (await this.getMedia(fileId, fileName)).url;
  }

  /**
   * Fetch a file for playback, reporting bytes as they land.
   *
   * The blob comes back alongside the object URL so the caller can stash it
   * offline without paying for a second download — the same bytes, used twice.
   */
  async getMedia(
    fileId: string,
    fileName = '',
    onProgress?: ProgressFn,
    expectedBytes = 0
  ): Promise<{ url: string; blob: Blob; fromCache: boolean }> {
    const cached = await this.offline.getBlob(fileId);
    if (cached) {
      const blob = this.playable(cached, fileName);
      onProgress?.(blob.size, blob.size);
      return { url: URL.createObjectURL(blob), blob, fromCache: true };
    }

    const res = await this.request(
      `${DRIVE_FILES}/${fileId}?alt=media&supportsAllDrives=true`
    );
    if (!res.ok) throw new Error(`Could not download that chapter (${res.status}).`);

    const raw = onProgress
      ? await readWithProgress(res, onProgress, expectedBytes)
      : await res.blob();
    const blob = this.playable(raw, fileName);
    return { url: URL.createObjectURL(blob), blob, fromCache: false };
  }


  /**
   * Give the blob a type `<audio>` will accept. Drive frequently reports .m4b
   * as `application/octet-stream` or `video/mp4`, and an object URL carrying
   * either of those gets rejected before a single byte is decoded.
   */
  private playable(blob: Blob, fileName: string): Blob {
    const wanted = PLAY_MIME[this.extension(fileName)];
    if (!wanted) return blob;
    if (blob.type === wanted) return blob;
    if (blob.type.startsWith('audio/') && blob.type !== 'audio/x-m4b') return blob;
    return new Blob([blob], { type: wanted });
  }

  /** Raw bytes — used by the offline "plunder" downloader. */
  async getBlob(fileId: string): Promise<Blob> {
    const res = await this.request(
      `${DRIVE_FILES}/${fileId}?alt=media&supportsAllDrives=true`
    );
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    return res.blob();
  }

  /** Cover image as a data URL, small enough to keep in local storage. */
  async getCoverDataUrl(fileId: string): Promise<string> {
    const blob = await this.getBlob(fileId);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Could not read cover image.'));
      reader.readAsDataURL(blob);
    });
  }

  // ── appDataFolder sync ───────────────────────────────────────────────────
  /** Find the app's hidden sync file, if it has been written before. */
  private async findAppDataFile(name: string): Promise<string | null> {
    const params = new URLSearchParams({
      q: `name = '${name}' and trashed = false`,
      spaces: 'appDataFolder',
      fields: 'files(id, name, modifiedTime)',
      pageSize: '10',
    });
    const data = await this.apiJson(`${DRIVE_FILES}?${params}`);
    return data.files?.[0]?.id ?? null;
  }

  async readAppData<T>(name: string): Promise<T | null> {
    const id = await this.findAppDataFile(name);
    if (!id) return null;
    const res = await this.request(`${DRIVE_FILES}/${id}?alt=media`);
    if (!res.ok) return null;
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  /** Create or overwrite the hidden sync file. Returns its file id. */
  async writeAppData(name: string, payload: unknown): Promise<string> {
    const existing = await this.findAppDataFile(name);
    const metadata = existing
      ? { name }
      : { name, parents: ['appDataFolder'] };

    const body = this.multipart(metadata, JSON.stringify(payload), 'application/json');
    const url = existing
      ? `${DRIVE_UPLOAD}/${existing}?uploadType=multipart&fields=id`
      : `${DRIVE_UPLOAD}?uploadType=multipart&fields=id`;

    const res = await this.request(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${body.boundary}` },
      body: body.content,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Could not save to Drive (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    return json.id as string;
  }

  // ── writing files into a book's folder ───────────────────────────────────
  /**
   * Drop a text file (the Cap'n's Log export) into a folder. Uses the
   * `drive.file` scope, which lets the app create files but never read the
   * user's other documents. Overwrites the app's previous export when the
   * caller passes the id it got back last time.
   */
  async writeTextFile(opts: {
    name: string;
    text: string;
    mimeType?: string;
    parentFolderId?: string;
    existingFileId?: string;
  }): Promise<string> {
    const mime = opts.mimeType ?? 'text/markdown';
    const metadata: Record<string, unknown> = { name: opts.name, mimeType: mime };
    if (!opts.existingFileId && opts.parentFolderId) {
      metadata['parents'] = [opts.parentFolderId];
    }
    const body = this.multipart(metadata, opts.text, mime);
    const url = opts.existingFileId
      ? `${DRIVE_UPLOAD}/${opts.existingFileId}?uploadType=multipart&fields=id&supportsAllDrives=true`
      : `${DRIVE_UPLOAD}?uploadType=multipart&fields=id&supportsAllDrives=true`;

    const res = await this.request(url, {
      method: opts.existingFileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${body.boundary}` },
      body: body.content,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Drive refused the write (${res.status}): ${text.slice(0, 200)}`
      );
    }
    return (await res.json()).id as string;
  }

  /** Build a multipart/related upload body: JSON metadata + the payload. */
  private multipart(
    metadata: unknown,
    content: string,
    contentType: string
  ): { boundary: string; content: string } {
    const boundary = `yarnbeard-${newId()}`;
    const parts =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${contentType}; charset=UTF-8\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`;
    return { boundary, content: parts };
  }
}
