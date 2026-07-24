import { Injectable, inject } from '@angular/core';
import { LibraryService } from './library.service';
import { OfflineService } from './offline.service';
import { Book } from '../models';
import { buildFileChapters } from '../util/chapters';
import { Mp4Meta, readMp4Meta } from '../util/mp4';
import { parseFolderTitle } from '../util/format';

/** Extensions we'll accept from the device picker. */
const AUDIO_EXT = /\.(mp3|m4a|m4b|mp4|aac|wav|ogg|oga|flac|opus|wma)$/i;
const MP4_EXT = /\.(m4b|m4a|mp4)$/i;

/** Same relabelling the Drive path uses, so `.m4b` blobs actually play. */
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

/** Stable id from a file's identity, so re-adding the same file resumes it. */
function localId(file: File): string {
  const seed = `${file.name}|${file.size}|${file.lastModified}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `local-${(h >>> 0).toString(36)}-${file.size.toString(36)}`;
}

/**
 * Add audiobooks straight from the device — no Google account, no network.
 *
 * Each picked file becomes a book whose bytes are stored, pinned, in the
 * offline cache. Because every playback path checks that cache before reaching
 * for Drive, a local book plays through exactly the same machinery as a Drive
 * book while never touching Google. `.m4b`/`.mp4` files have their embedded
 * chapters, title, author and cover read out just as Drive files do.
 */
@Injectable({ providedIn: 'root' })
export class LocalService {
  private library = inject(LibraryService);
  private offline = inject(OfflineService);

  isAudioFile(file: File): boolean {
    return (
      (file.type && file.type.startsWith('audio/')) ||
      file.type === 'video/mp4' ||
      AUDIO_EXT.test(file.name)
    );
  }

  private extension(name: string): string {
    return (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toLowerCase();
  }

  /** Give the blob a type `<audio>` will accept, as Drive downloads get. */
  private playable(file: File): Blob {
    const wanted = PLAY_MIME[this.extension(file.name)];
    if (!wanted || file.type === wanted) return file;
    if (file.type.startsWith('audio/')) return file;
    return new Blob([file], { type: wanted });
  }

  /**
   * Import a set of picked files. Each becomes one book. Files that are already
   * on the shelf (same name, size and date) are refreshed in place rather than
   * duplicated. Returns the books that were added or updated.
   */
  async addFiles(
    files: File[],
    onProgress?: (done: number, total: number, name: string) => void
  ): Promise<Book[]> {
    const audio = files.filter((f) => this.isAudioFile(f));
    if (!audio.length) {
      throw new Error('None of those were audio files.');
    }

    const added: Book[] = [];
    for (let i = 0; i < audio.length; i++) {
      const file = audio[i];
      onProgress?.(i, audio.length, file.name);
      try {
        added.push(await this.addOne(file));
      } catch {
        /* one unreadable file shouldn't sink the rest of the batch */
      }
    }
    onProgress?.(audio.length, audio.length, '');
    if (!added.length) throw new Error('None of those files could be opened.');
    return added;
  }

  private async addOne(file: File): Promise<Book> {
    const id = localId(file);

    // Read chapters/tags straight from the File — slicing a Blob needs no
    // network and no cache round-trip.
    let meta: Mp4Meta | null = null;
    if (MP4_EXT.test(file.name) && file.size > 0) {
      try {
        meta = await readMp4Meta(
          async (start, end) =>
            new Uint8Array(
              await file.slice(start, Math.min(end, file.size - 1) + 1).arrayBuffer()
            ),
          file.size
        );
      } catch {
        meta = null;
      }
    }

    const blob = this.playable(file);

    // Store the bytes, pinned: this is the only copy — the picked File can't be
    // re-read in a later session, so it must never be evicted.
    await this.offline.put(id, blob, true);

    const fallbackTitle = file.name.replace(/\.[a-z0-9]{1,5}$/i, '');
    const parsed = parseFolderTitle(fallbackTitle);

    const book: Book = {
      id,
      kind: 'file',
      source: 'local',
      title: meta?.title || meta?.album || parsed.title || fallbackTitle,
      folderName: file.name,
      author: meta?.author || parsed.author,
      chapters: buildFileChapters(id, file.name, blob.type || undefined, file.size, meta),
      embeddedChapters: (meta?.chapters.length ?? 0) > 0,
      addedAt: Date.now(),
      refreshedAt: Date.now(),
      tags: [],
    };

    const stored = this.library.upsert(book);
    if (meta?.coverDataUrl) this.library.setCover(id, meta.coverDataUrl);
    return stored;
  }
}
