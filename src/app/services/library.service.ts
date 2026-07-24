import { Injectable, computed, inject, signal } from '@angular/core';
import { DriveService } from './drive.service';
import { ProgressService } from './progress.service';
import { Book, Shelf, ShelfFilter, SortMode } from '../models';
import { naturalCompare, newId } from '../util/format';

const BOOKS_KEY = 'yarnbeard.books.v1';
const SHELVES_KEY = 'yarnbeard.shelves.v1';
const COVERS_KEY = 'yarnbeard.covers.v1';

/** The Hold: every book Yarnbeard knows about, and the shelves they came from. */
@Injectable({ providedIn: 'root' })
export class LibraryService {
  private drive = inject(DriveService);
  private progress = inject(ProgressService);

  readonly books = signal<Book[]>(this.readBooks());
  readonly shelves = signal<Shelf[]>(this.readShelves());
  /** bookId → cover image data URL, cached so the shelf paints instantly. */
  readonly covers = signal<Record<string, string>>(this.readCovers());

  readonly count = computed(() => this.books().length);

  /** Books in progress, most recently touched first — the "continue" rail. */
  readonly inProgress = computed(() => {
    const map = this.progress.map();
    return this.books()
      .filter((b) => {
        const p = map[b.id];
        return !!p && !p.finishedAt && (p.position > 30 || p.chapterIndex > 0);
      })
      .sort((a, b) => (map[b.id]?.updatedAt ?? 0) - (map[a.id]?.updatedAt ?? 0));
  });

  /** The single book to offer on launch. */
  readonly lastPlayed = computed<Book | null>(() => this.inProgress()[0] ?? null);

  // ── storage ──────────────────────────────────────────────────────────────
  private readBooks(): Book[] {
    try {
      const raw = localStorage.getItem(BOOKS_KEY);
      const list = raw ? (JSON.parse(raw) as Book[]) : [];
      return Array.isArray(list) ? list.map((b) => this.normalize(b)) : [];
    } catch {
      return [];
    }
  }

  /**
   * Books saved before single-file support had no `kind` and no `fileId` on
   * their chapters — back then a chapter *was* a file. Fill both in so the
   * rest of the app can assume they're there.
   */
  private normalize(book: Book): Book {
    if (book.kind && book.chapters?.every((c) => c.fileId)) return book;
    return {
      ...book,
      kind: book.kind ?? 'folder',
      chapters: (book.chapters ?? []).map((c) => ({ ...c, fileId: c.fileId ?? c.id })),
    };
  }

  private readShelves(): Shelf[] {
    try {
      const raw = localStorage.getItem(SHELVES_KEY);
      const list = raw ? (JSON.parse(raw) as Shelf[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private readCovers(): Record<string, string> {
    try {
      const raw = localStorage.getItem(COVERS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private writeBooks(): void {
    try {
      localStorage.setItem(BOOKS_KEY, JSON.stringify(this.books()));
    } catch {
      /* ignore */
    }
  }

  private writeShelves(): void {
    try {
      localStorage.setItem(SHELVES_KEY, JSON.stringify(this.shelves()));
    } catch {
      /* ignore */
    }
  }

  private writeCovers(): void {
    try {
      localStorage.setItem(COVERS_KEY, JSON.stringify(this.covers()));
    } catch {
      // Covers are the first thing to blow a storage quota — drop them all
      // rather than wedging the app; they'll be re-fetched from Drive.
      this.covers.set({});
    }
  }

  // ── reads ────────────────────────────────────────────────────────────────
  get(bookId: string): Book | undefined {
    return this.books().find((b) => b.id === bookId);
  }

  cover(bookId: string): string | undefined {
    return this.covers()[bookId];
  }

  /** Filter + sort for the shelf page. */
  view(opts: { filter: ShelfFilter; sort: SortMode; query: string }): Book[] {
    const map = this.progress.map();
    const q = opts.query.trim().toLowerCase();

    let list = this.books().filter((b) => {
      if (q) {
        const hay = `${b.title} ${b.author ?? ''} ${(b.tags ?? []).join(' ')}`;
        if (!hay.toLowerCase().includes(q)) return false;
      }
      const p = map[b.id];
      switch (opts.filter) {
        case 'reading':
          return !!p && !p.finishedAt && (p.position > 30 || p.chapterIndex > 0);
        case 'unstarted':
          return !p || (!p.finishedAt && p.position <= 30 && p.chapterIndex === 0);
        case 'finished':
          return !!p?.finishedAt;
        default:
          return true;
      }
    });

    const cmp: Record<SortMode, (a: Book, b: Book) => number> = {
      recent: (a, b) => (map[b.id]?.updatedAt ?? 0) - (map[a.id]?.updatedAt ?? 0),
      title: (a, b) => naturalCompare(a.title, b.title),
      author: (a, b) => naturalCompare(a.author ?? '~', b.author ?? '~'),
      added: (a, b) => b.addedAt - a.addedAt,
      progress: (a, b) => this.progress.percent(b) - this.progress.percent(a),
    };
    list = [...list].sort(cmp[opts.sort] ?? cmp.recent);
    return list;
  }

  /** Every distinct tag in the library, for the filter chips. */
  allTags(): string[] {
    const set = new Set<string>();
    for (const b of this.books()) for (const t of b.tags ?? []) set.add(t);
    return [...set].sort((a, b) => naturalCompare(a, b));
  }

  // ── writes ───────────────────────────────────────────────────────────────
  /** Add or replace a book, keeping the earliest addedAt so shelves stay stable. */
  upsert(book: Book): Book {
    let stored = book;
    this.books.update((list) => {
      const i = list.findIndex((b) => b.id === book.id);
      if (i < 0) return [...list, book];
      stored = { ...book, addedAt: list[i].addedAt };
      return list.map((b, j) => (j === i ? stored : b));
    });
    this.writeBooks();

    // Cover art embedded in an .m4b is already in hand — take it before
    // falling back to fetching an image file from the folder.
    const embedded = this.drive.takeEmbeddedCover(stored.id);
    if (embedded) this.setCover(stored.id, embedded);
    else void this.ensureCover(stored);

    return stored;
  }

  /**
   * Shelve everything behind a pasted link.
   *
   * `mode: 'files'` (the default) treats **each audio file as its own book** —
   * the right reading for a Drive folder of .m4b audiobooks, and the one that
   * lets embedded chapter markers do their job. `mode: 'folder'` keeps the
   * older shape, where a folder of numbered files is one book.
   *
   * A link that points straight at a file is always a single book, whichever
   * mode is asked for.
   */
  async addFromLink(
    linkOrId: string,
    mode: 'files' | 'folder' = 'files',
    onProgress?: (done: number, total: number, name: string) => void
  ): Promise<Book[]> {
    const id = this.drive.parseFolderId(linkOrId);
    if (!id) throw new Error('Paste a Drive folder link or id first.');

    if (!(await this.drive.isFolderId(id))) {
      return [this.upsert(await this.drive.scanFileAsBook(id))];
    }

    const name = await this.drive.getFolderName(id);
    const found =
      mode === 'files'
        ? await this.drive.scanFolderAsFileBooks(id, onProgress)
        : await this.drive.scanShelf(id, onProgress);

    const saved = found.map((b) => this.upsert(b));
    this.rememberShelf(id, name, mode, saved.length);
    return saved;
  }

  /** Keep the folder so pull-to-refresh can look for books added since. */
  private rememberShelf(
    folderId: string,
    name: string,
    mode: 'files' | 'folder',
    found: number
  ): void {
    if (found < 2) return;
    const existing = this.shelves().find((s) => s.folderId === folderId);
    if (existing) {
      if (existing.mode === mode) return;
      this.shelves.update((list) =>
        list.map((s) => (s.folderId === folderId ? { ...s, mode } : s))
      );
    } else {
      this.shelves.update((list) => [
        ...list,
        { id: newId(), name, folderId, mode, addedAt: Date.now() },
      ]);
    }
    this.writeShelves();
  }

  /** Re-read one book's folder — picks up chapters added since. */
  async refresh(bookId: string): Promise<Book> {
    const book = this.get(bookId);
    if (!book) throw new Error('That book is not on the shelf.');
    // A local book has no Drive origin to re-scan; re-add the file instead.
    if (book.source === 'local') return book;
    return this.upsert(await this.drive.refreshBook(book));
  }

  /**
   * Re-scan every saved folder, adding books that appeared since. Books already
   * on the shelf are left alone — re-parsing every .m4b on every pull would be
   * a lot of reading for nothing.
   */
  async refreshShelves(
    onProgress?: (done: number, total: number, name: string) => void
  ): Promise<number> {
    let added = 0;
    for (const shelf of this.shelves()) {
      if (shelf.mode === 'folder') {
        const found = await this.drive.scanShelf(shelf.folderId, onProgress);
        for (const b of found) {
          if (this.get(b.id)) continue;
          added++;
          this.upsert(b);
        }
        continue;
      }

      // File-per-book: list ids cheaply, then open only what we haven't seen.
      const files = await this.drive.listAudioFiles(shelf.folderId);
      const fresh = files.filter((f) => !this.get(f.id));
      for (let i = 0; i < fresh.length; i++) {
        onProgress?.(i, fresh.length, fresh[i].name);
        try {
          this.upsert(await this.drive.scanFileAsBook(fresh[i].id));
          added++;
        } catch {
          /* skip the ones that won't open */
        }
      }
    }
    return added;
  }

  edit(bookId: string, patch: Partial<Pick<Book, 'title' | 'author' | 'tags'>>): void {
    this.books.update((list) =>
      list.map((b) => (b.id === bookId ? { ...b, ...patch } : b))
    );
    this.writeBooks();
  }

  remove(bookId: string): void {
    this.books.update((list) => list.filter((b) => b.id !== bookId));
    this.writeBooks();
    this.covers.update((c) => {
      const next = { ...c };
      delete next[bookId];
      return next;
    });
    this.writeCovers();
  }

  removeShelf(shelfId: string): void {
    this.shelves.update((list) => list.filter((s) => s.id !== shelfId));
    this.writeShelves();
  }

  // ── covers ───────────────────────────────────────────────────────────────
  /** Store a cover data URL, ignoring anything too big for local storage. */
  setCover(bookId: string, dataUrl: string): void {
    if (!dataUrl || dataUrl.length > 900_000) return;
    this.covers.update((c) => ({ ...c, [bookId]: dataUrl }));
    this.writeCovers();
  }

  /** Fetch a book's cover image file once and keep it as a data URL. */
  private async ensureCover(book: Book): Promise<void> {
    if (!book.coverFileId || this.covers()[book.id]) return;
    try {
      this.setCover(book.id, await this.drive.getCoverDataUrl(book.coverFileId));
    } catch {
      /* no cover is fine — the generated flag takes over */
    }
  }

  /** Re-fetch covers for anything missing one (after a sync, say). */
  async backfillCovers(): Promise<void> {
    for (const b of this.books()) await this.ensureCover(b);
  }

  // ── sync plumbing ────────────────────────────────────────────────────────
  snapshotBooks(): Book[] {
    return this.books();
  }

  snapshotShelves(): Shelf[] {
    return this.shelves();
  }

  /**
   * Union by id. A book is a Drive folder, so identical ids really are the same
   * book; we keep whichever copy was refreshed more recently.
   */
  mergeBooks(incoming: Book[] | undefined): void {
    if (!Array.isArray(incoming) || !incoming.length) return;
    this.books.update((mine) => {
      const byId = new Map(mine.map((b) => [b.id, b]));
      for (const raw of incoming) {
        const b = this.normalize(raw);
        const ours = byId.get(b.id);
        if (!ours || (b.refreshedAt ?? 0) > (ours.refreshedAt ?? 0)) {
          byId.set(b.id, { ...b, addedAt: Math.min(b.addedAt, ours?.addedAt ?? b.addedAt) });
        }
      }
      return [...byId.values()];
    });
    this.writeBooks();
  }

  mergeShelves(incoming: Shelf[] | undefined): void {
    if (!Array.isArray(incoming) || !incoming.length) return;
    this.shelves.update((mine) => {
      const byFolder = new Map(mine.map((s) => [s.folderId, s]));
      for (const s of incoming) {
        if (!byFolder.has(s.folderId)) byFolder.set(s.folderId, s);
      }
      return [...byFolder.values()];
    });
    this.writeShelves();
  }

  replaceAll(books: Book[], shelves: Shelf[]): void {
    this.books.set(Array.isArray(books) ? books.map((b) => this.normalize(b)) : []);
    this.shelves.set(Array.isArray(shelves) ? shelves : []);
    this.writeBooks();
    this.writeShelves();
  }
}
