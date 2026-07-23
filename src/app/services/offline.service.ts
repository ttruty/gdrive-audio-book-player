import { Injectable, computed, inject, signal } from '@angular/core';
import { GoogleAuthService } from './google-auth.service';
import { SettingsService } from './settings.service';
import { selectForEviction } from '../util/evict';

const CACHE_NAME = 'yarnbeard-hold-v1';
/** v1 held a bare id list; v2 carries sizes and last-used stamps for eviction. */
const INDEX_KEY = 'yarnbeard.offline.v2';
const LEGACY_INDEX_KEY = 'yarnbeard.offline.v1';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

/** A book currently being downloaded. */
export interface StowJob {
  bookId: string;
  title: string;
  done: number;
  total: number;
  /** Set when a chapter failed; the job keeps going with the rest. */
  failed: number;
  cancel: boolean;
}

interface CacheEntry {
  size: number;
  /** Millis — drives least-recently-used eviction. */
  lastUsed: number;
  /**
   * Explicitly downloaded by the listener. Pinned files are never evicted to
   * make room; only what playback kept on its own is fair game.
   */
  pinned: boolean;
}

/**
 * The Hold — audio kept in Cache Storage.
 *
 * Two things live here. Files the listener *chose* to download are pinned and
 * stay until they remove them. Files playback happened to fetch are kept too,
 * because re-downloading a book you were listening to yesterday is the single
 * most annoying thing this app could do — but they're evicted least-recently-
 * used once the cache exceeds its budget, so the disk cost stays bounded.
 *
 * Cache Storage is the source of truth for the bytes; localStorage holds the
 * index so the UI can react without awaiting the cache on every paint.
 */
@Injectable({ providedIn: 'root' })
export class OfflineService {
  private auth = inject(GoogleAuthService);
  private settings = inject(SettingsService);

  private entries = signal<Record<string, CacheEntry>>(this.readIndex());

  readonly cachedIds = computed(() => new Set(Object.keys(this.entries())));
  readonly downloading = signal<Set<string>>(new Set());
  /** Active whole-book downloads, keyed by book id. */
  readonly jobs = signal<Record<string, StowJob>>({});

  /** Total bytes we believe are cached. */
  readonly cacheBytes = computed(() =>
    Object.values(this.entries()).reduce((n, e) => n + (e.size || 0), 0)
  );

  readonly keptCount = computed(
    () => Object.values(this.entries()).filter((e) => !e.pinned).length
  );

  private readIndex(): Record<string, CacheEntry> {
    try {
      const raw = localStorage.getItem(INDEX_KEY);
      if (raw) return JSON.parse(raw) as Record<string, CacheEntry>;

      // Migrate the old id-only list. Sizes are unknown until each file is
      // next touched; treating them as pinned preserves the old promise that
      // a downloaded book stays downloaded.
      const legacy = localStorage.getItem(LEGACY_INDEX_KEY);
      if (!legacy) return {};
      const out: Record<string, CacheEntry> = {};
      for (const id of JSON.parse(legacy) as string[]) {
        out[id] = { size: 0, lastUsed: Date.now(), pinned: true };
      }
      return out;
    } catch {
      return {};
    }
  }

  private writeIndex(): void {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(this.entries()));
    } catch {
      /* ignore */
    }
  }

  private key(id: string): string {
    return `offline/${id}`;
  }

  private supported(): boolean {
    return typeof caches !== 'undefined';
  }

  isCached(id: string): boolean {
    return !!this.entries()[id];
  }

  isPinned(id: string): boolean {
    return !!this.entries()[id]?.pinned;
  }

  isDownloading(id: string): boolean {
    return this.downloading().has(id);
  }

  /** How many of a book's files are cached at all. */
  cachedCount(fileIds: string[]): number {
    const e = this.entries();
    return fileIds.reduce((n, id) => n + (e[id] ? 1 : 0), 0);
  }

  /** How many are pinned — i.e. safe from eviction. */
  pinnedCount(fileIds: string[]): number {
    const e = this.entries();
    return fileIds.reduce((n, id) => n + (e[id]?.pinned ? 1 : 0), 0);
  }

  job(bookId: string): StowJob | undefined {
    return this.jobs()[bookId];
  }

  async getBlob(id: string): Promise<Blob | null> {
    if (!this.supported() || !this.isCached(id)) return null;
    try {
      const cache = await caches.open(CACHE_NAME);
      const res = await cache.match(this.key(id));
      if (!res) {
        // The browser evicted the bytes behind our back — drop the stale row.
        this.forget(id);
        return null;
      }
      const blob = await res.blob();
      this.touch(id, blob.size);
      return blob;
    } catch {
      return null;
    }
  }

  /** Mark a file as just used, and record its true size if we didn't know it. */
  private touch(id: string, size = 0): void {
    this.entries.update((m) => {
      const cur = m[id];
      if (!cur) return m;
      return {
        ...m,
        [id]: { ...cur, lastUsed: Date.now(), size: cur.size || size },
      };
    });
    this.writeIndex();
  }

  private forget(id: string): void {
    this.entries.update((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    this.writeIndex();
  }

  /**
   * Keep bytes we already have. The player hands over the blob it just fetched
   * for playback rather than making us download the same file a second time.
   */
  async put(id: string, blob: Blob, pinned = false): Promise<void> {
    if (!this.supported()) return;
    if (this.isCached(id)) {
      // Already here — just refresh its standing, and pin it if asked.
      this.touch(id, blob.size);
      if (pinned) this.pin(id);
      return;
    }

    // A file bigger than the whole budget would evict everything and still not
    // fit, so unpinned copies of it aren't worth keeping.
    const budget = this.budgetBytes();
    if (!pinned && budget > 0 && blob.size > budget) return;

    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(this.key(id), new Response(blob));
      this.entries.update((m) => ({
        ...m,
        [id]: { size: blob.size, lastUsed: Date.now(), pinned },
      }));
      this.writeIndex();
      await this.enforceBudget();
    } catch {
      /* over quota — the book still plays, it just won't be offline */
    }
  }

  pin(id: string): void {
    this.entries.update((m) =>
      m[id] ? { ...m, [id]: { ...m[id], pinned: true } } : m
    );
    this.writeIndex();
  }

  /** Download a single file. Explicit downloads pin; read-ahead does not. */
  async download(id: string, pinned = true): Promise<void> {
    if (!this.supported() || this.isDownloading(id)) return;
    if (this.isCached(id)) {
      if (pinned) this.pin(id);
      return;
    }

    this.downloading.update((s) => new Set(s).add(id));
    try {
      let token = await this.auth.getValidToken();
      const url = `${DRIVE_FILES}/${id}?alt=media&supportsAllDrives=true`;
      let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        token = await this.auth.signIn(true);
        res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      }
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      await this.put(id, await res.blob(), pinned);
    } finally {
      this.downloading.update((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  /**
   * Download a whole book, one file at a time so a big book doesn't open twenty
   * parallel connections. Failures are counted rather than fatal — a book with
   * one bad file still gets the other nineteen.
   */
  async downloadBook(
    bookId: string,
    title: string,
    fileIds: string[]
  ): Promise<StowJob> {
    const pending = fileIds.filter((id) => !this.isPinned(id));
    const job: StowJob = {
      bookId,
      title,
      done: 0,
      total: pending.length,
      failed: 0,
      cancel: false,
    };
    if (!pending.length) return job;

    this.setJob(bookId, job);
    for (const id of pending) {
      if (this.jobs()[bookId]?.cancel) break;
      try {
        await this.download(id, true);
      } catch {
        job.failed++;
      }
      job.done++;
      this.setJob(bookId, { ...job });
    }
    this.clearJob(bookId);
    return job;
  }

  cancelBook(bookId: string): void {
    const j = this.jobs()[bookId];
    if (j) this.setJob(bookId, { ...j, cancel: true });
  }

  private setJob(bookId: string, job: StowJob): void {
    this.jobs.update((m) => ({ ...m, [bookId]: job }));
  }

  private clearJob(bookId: string): void {
    this.jobs.update((m) => {
      const next = { ...m };
      delete next[bookId];
      return next;
    });
  }

  async remove(id: string): Promise<void> {
    if (this.supported()) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.delete(this.key(id));
      } catch {
        /* ignore */
      }
    }
    this.forget(id);
  }

  async removeBook(fileIds: string[]): Promise<void> {
    for (const id of fileIds) await this.remove(id);
  }

  /** Drop the auto-kept files but leave everything explicitly downloaded. */
  async clearUnpinned(): Promise<void> {
    const ids = Object.entries(this.entries())
      .filter(([, e]) => !e.pinned)
      .map(([id]) => id);
    for (const id of ids) await this.remove(id);
  }

  async clearAll(): Promise<void> {
    if (this.supported()) {
      try {
        await caches.delete(CACHE_NAME);
      } catch {
        /* ignore */
      }
    }
    this.entries.set({});
    this.writeIndex();
  }

  // ── budget ───────────────────────────────────────────────────────────────
  /** 0 means no limit. */
  private budgetBytes(): number {
    return this.settings.cacheBudgetGb() * 1024 * 1024 * 1024;
  }

  /**
   * Evict least-recently-used *unpinned* files until the cache fits its budget.
   * Entries whose size we never learned count as zero, so they survive until a
   * play touches them and fills the number in — which is the safe direction.
   */
  async enforceBudget(): Promise<void> {
    const doomed = selectForEviction(
      Object.entries(this.entries()).map(([id, e]) => ({ id, ...e })),
      this.budgetBytes()
    );
    for (const id of doomed) await this.remove(id);
  }

  /** Best-effort disk usage, when the browser is willing to say. */
  async usage(): Promise<{ used: number; quota: number } | null> {
    try {
      const est = await navigator.storage?.estimate?.();
      if (!est) return null;
      return { used: est.usage ?? 0, quota: est.quota ?? 0 };
    } catch {
      return null;
    }
  }

  /**
   * Ask the browser not to evict the cache under storage pressure. Chrome
   * grants this to installed/engaged sites; elsewhere it just returns false.
   */
  async requestPersistence(): Promise<boolean> {
    try {
      return (await navigator.storage?.persist?.()) ?? false;
    } catch {
      return false;
    }
  }
}
