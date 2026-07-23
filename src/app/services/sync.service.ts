import { Injectable, effect, inject, signal } from '@angular/core';
import { DriveService } from './drive.service';
import { GoogleAuthService } from './google-auth.service';
import { LibraryService } from './library.service';
import { ProgressService } from './progress.service';
import { BookmarksService } from './bookmarks.service';
import { NotesService } from './notes.service';
import { StatsService } from './stats.service';
import { SettingsService } from './settings.service';
import { LibrarySnapshot } from '../models';

const FILE_NAME = 'yarnbeard-library.json';
/** Wait this long after the last change before pushing, to batch edits. */
const PUSH_DEBOUNCE_MS = 8_000;
/** Never push more often than this, however busy the listener is. */
const MIN_PUSH_INTERVAL_MS = 30_000;

export type SyncState = 'idle' | 'pulling' | 'pushing' | 'error' | 'off';

/**
 * Ties the library to Drive's hidden appDataFolder — one JSON file holding
 * books, progress, bookmarks, notes and stats. It is invisible in the user's
 * Drive UI and only this app can read it, which is the right home for reading
 * positions. Merges are per-record rather than whole-file, so listening on the
 * phone and the laptop on the same day doesn't cost you a bookmark.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private drive = inject(DriveService);
  private auth = inject(GoogleAuthService);
  private library = inject(LibraryService);
  private progress = inject(ProgressService);
  private bookmarks = inject(BookmarksService);
  private notes = inject(NotesService);
  private stats = inject(StatsService);
  private settings = inject(SettingsService);

  readonly state = signal<SyncState>('idle');
  readonly lastSyncedAt = signal<number | null>(this.readStamp());
  readonly lastError = signal<string | null>(null);

  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPushAt = 0;
  private pulled = false;
  private inFlight: Promise<void> | null = null;

  constructor() {
    // Any change to library data schedules a push (once signed in and enabled).
    effect(() => {
      // Read the signals so the effect subscribes to them.
      this.library.books();
      this.library.shelves();
      this.progress.map();
      this.bookmarks.all();
      this.notes.all();
      this.stats.days();
      this.schedulePush();
    });

    if (typeof window !== 'undefined') {
      // Best-effort flush when the tab goes away.
      window.addEventListener('pagehide', () => void this.pushNow(true));
      window.addEventListener('online', () => this.schedulePush());
    }
  }

  private readStamp(): number | null {
    const raw = localStorage.getItem('yarnbeard.sync.at');
    return raw ? Number(raw) : null;
  }

  private writeStamp(ms: number): void {
    this.lastSyncedAt.set(ms);
    try {
      localStorage.setItem('yarnbeard.sync.at', String(ms));
    } catch {
      /* ignore */
    }
  }

  private get enabled(): boolean {
    return this.settings.syncToDrive() && this.auth.isSignedIn();
  }

  private snapshot(): LibrarySnapshot {
    return {
      app: 'yarnbeard',
      version: 1,
      updatedAt: Date.now(),
      books: this.library.snapshotBooks(),
      shelves: this.library.snapshotShelves(),
      progress: this.progress.snapshot(),
      bookmarks: this.bookmarks.snapshot(),
      notes: this.notes.snapshot(),
      stats: this.stats.snapshot(),
    };
  }

  /** Fold a remote snapshot into local state without clobbering newer work. */
  private applyIncoming(remote: LibrarySnapshot): void {
    this.library.mergeBooks(remote.books);
    this.library.mergeShelves(remote.shelves);
    this.progress.merge(remote.progress);
    this.bookmarks.merge(remote.bookmarks);
    this.notes.merge(remote.notes);
    this.stats.merge(remote.stats);
  }

  /**
   * Pull once per session on sign-in, then push the merged result so the remote
   * file gains anything this device had that it didn't.
   */
  async pullOnce(): Promise<void> {
    if (!this.enabled || this.pulled) return;
    this.pulled = true;
    await this.pull();
  }

  async pull(): Promise<void> {
    if (!this.enabled) {
      this.state.set('off');
      return;
    }
    this.state.set('pulling');
    this.lastError.set(null);
    try {
      const remote = await this.drive.readAppData<LibrarySnapshot>(FILE_NAME);
      if (remote?.app === 'yarnbeard') {
        this.applyIncoming(remote);
        void this.library.backfillCovers();
      }
      this.state.set('idle');
      this.writeStamp(Date.now());
      // Push the merge back so both sides agree.
      await this.pushNow(true);
    } catch (err: any) {
      this.state.set('error');
      this.lastError.set(err?.message ?? 'Could not read from Drive.');
    }
  }

  private schedulePush(): void {
    if (!this.enabled) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.pushNow(), PUSH_DEBOUNCE_MS);
  }

  /** Write the current snapshot to Drive. `force` bypasses the rate limit. */
  async pushNow(force = false): Promise<void> {
    if (!this.enabled) return;
    if (!force && Date.now() - this.lastPushAt < MIN_PUSH_INTERVAL_MS) {
      this.schedulePush();
      return;
    }
    if (this.inFlight) return this.inFlight;

    this.state.set('pushing');
    this.inFlight = (async () => {
      try {
        await this.drive.writeAppData(FILE_NAME, this.snapshot());
        this.lastPushAt = Date.now();
        this.writeStamp(this.lastPushAt);
        this.state.set('idle');
        this.lastError.set(null);
      } catch (err: any) {
        this.state.set('error');
        this.lastError.set(err?.message ?? 'Could not save to Drive.');
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /** Reset the once-per-session guard (used after sign-out/sign-in). */
  resetSession(): void {
    this.pulled = false;
  }
}
