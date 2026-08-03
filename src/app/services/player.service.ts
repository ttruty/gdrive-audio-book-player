import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DriveService } from './drive.service';
import { LibraryService } from './library.service';
import { ProgressService } from './progress.service';
import { SettingsService } from './settings.service';
import { StatsService } from './stats.service';
import { OfflineService } from './offline.service';
import { CrestService } from './crest.service';
import { Book, Chapter } from '../models';

const PLAYBACK_KEY = 'yarnbeard.playback.v1';
const RATES_KEY = 'yarnbeard.rates.v1';
/** Persist the reading position at most this often while playing. */
const SAVE_INTERVAL_MS = 10_000;

/** Skip-silence: only fast-forward once quiet has run longer than this. */
const SILENCE_RMS = 0.012;
const SILENCE_SKIP_AFTER = 1.2; // seconds — narration gaps, not dramatic pauses
const SILENCE_STEP = 0.2;

/** Sleep timer fade-out length. */
const FADE_SECONDS = 20;

interface StoredPlayback {
  bookId: string;
  chapterIndex: number;
  position: number;
  /** When we last stopped — feeds the smart-rewind calculation. */
  leftAt: number;
}

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private drive = inject(DriveService);
  private library = inject(LibraryService);
  private progress = inject(ProgressService);
  private settings = inject(SettingsService);
  private stats = inject(StatsService);
  private offline = inject(OfflineService);
  private crest = inject(CrestService);

  private audio = new Audio();
  private objectUrl: string | null = null;
  /** Which Drive file the audio element currently holds. */
  private loadedFileId: string | null = null;
  /** Guards against out-of-order loads when the listener taps fast. */
  private loadToken = 0;
  private preloaded: { id: string; url: string } | null = null;

  private lastPersist = 0;
  private lastTickTime = 0;
  /** Real audio seconds heard since the last stats flush. */
  private pendingListened = 0;

  // Web Audio graph, built lazily for boost + skip-silence.
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  // Speech-enhancement chain, flat (no-op) until "Enhance voice" is on.
  private highpass: BiquadFilterNode | null = null;
  private mudCut: BiquadFilterNode | null = null;
  private presence: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private silenceRAF: number | null = null;
  private silenceStart = -1;

  private sleepHandle: ReturnType<typeof setTimeout> | null = null;
  private fadeHandle: ReturnType<typeof setInterval> | null = null;
  private wakeLock: any = null;
  private perBookRates: Record<string, number> = this.readRates();

  // ── state ────────────────────────────────────────────────────────────────
  readonly book = signal<Book | null>(null);
  readonly chapterIndex = signal(-1);
  readonly isPlaying = signal(false);
  readonly loading = signal(false);
  readonly position = signal(0);
  readonly duration = signal(0);
  readonly error = signal<string | null>(null);
  readonly rate = signal(1);

  /**
   * First play of a file means waiting for the whole thing, so say how far
   * along it is rather than spinning silently. Bytes are 0 and the percent is
   * null whenever nothing is actually downloading.
   */
  readonly downloadedBytes = signal(0);
  readonly downloadTotal = signal(0);
  readonly downloadPercent = computed(() => {
    const total = this.downloadTotal();
    if (!this.loading() || total <= 0) return null;
    return Math.min(1, this.downloadedBytes() / total);
  });

  readonly sleepEndsAt = signal<number | null>(null);
  readonly stopAtChapterEnd = signal(false);
  readonly sleepActive = computed(
    () => this.sleepEndsAt() != null || this.stopAtChapterEnd()
  );

  readonly chapter = computed<Chapter | null>(() => {
    const b = this.book();
    const i = this.chapterIndex();
    return b && i >= 0 && i < b.chapters.length ? b.chapters[i] : null;
  });

  readonly hasNext = computed(() => {
    const b = this.book();
    return !!b && this.chapterIndex() < b.chapters.length - 1;
  });

  readonly hasPrev = computed(() => this.chapterIndex() > 0);

  /** 0–1 through the whole book, not just the chapter. */
  readonly bookPercent = computed(() => {
    const b = this.book();
    if (!b) return 0;
    // Read the position signal so this recomputes as playback moves.
    this.position();
    return this.progress.percent(b);
  });

  readonly remainingInChapter = computed(() =>
    Math.max(0, this.duration() - this.position())
  );

  constructor() {
    this.audio.preload = 'auto';
    this.wireAudioEvents();
    this.restore();
    this.setupMediaSession();

    effect(() => {
      this.audio.playbackRate = this.rate();
      this.updatePositionState();
    });

    effect(() => {
      const b = this.settings.boost();
      const enhance = this.settings.enhanceVoice();
      // Either feature needs the Web Audio graph; build it lazily, then apply.
      if (b > 1 || enhance) this.ensureAudioGraph();
      this.applyEnhance();
      this.updateGain();
    });

    effect(() => {
      if (this.settings.skipSilence()) {
        this.ensureAudioGraph();
        this.startSilenceLoop();
      }
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.isPlaying()) {
          void this.acquireWakeLock();
        }
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.persist());
    }
  }

  // ── chapter windows ──────────────────────────────────────────────────────
  /*
   * A chapter is a slice of a file: `[start, end)` for an embedded .m4b marker,
   * or the whole file for a folder book. Everything the UI sees — position,
   * duration, seeking — is expressed *within* that window, so a 40-chapter
   * single-file audiobook behaves exactly like 40 separate files.
   */
  private windowStart(): number {
    return this.chapter()?.start ?? 0;
  }

  private windowEnd(): number {
    const c = this.chapter();
    if (c?.end != null && c.end > 0) return c.end;
    const d = this.audio.duration;
    return isFinite(d) && d > 0 ? d : 0;
  }

  private windowLength(): number {
    const end = this.windowEnd();
    return end > 0 ? Math.max(0, end - this.windowStart()) : 0;
  }

  /** Seconds into the current chapter, straight from the audio element. */
  private relativeNow(): number {
    return Math.max(0, this.audio.currentTime - this.windowStart());
  }

  private wireAudioEvents(): void {
    this.audio.addEventListener('timeupdate', () => {
      const t = this.audio.currentTime;
      const prev = this.lastTickTime;
      this.lastTickTime = t;

      // Count only forward movement that looks like listening, not seeking.
      const delta = t - prev;
      if (delta > 0 && delta < 5) this.pendingListened += delta;

      this.position.set(Math.max(0, t - this.windowStart()));
      this.duration.set(this.windowLength());
      this.updatePositionState();

      this.checkChapterBoundary(t);

      if (Date.now() - this.lastPersist > SAVE_INTERVAL_MS) this.persist();
    });

    this.audio.addEventListener('durationchange', () => {
      this.duration.set(this.windowLength());
      this.updatePositionState();
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying.set(true);
      this.setPlaybackState('playing');
      this.startSilenceLoop();
      void this.acquireWakeLock();
      this.persist();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying.set(false);
      this.setPlaybackState('paused');
      this.releaseWakeLock();
      this.persist();
    });

    this.audio.addEventListener('ended', () => this.onChapterEnded());

    this.audio.addEventListener('error', () => {
      if (this.audio.src) {
        this.error.set('That chapter would not play — the file may be corrupt.');
      }
    });
  }

  // ── opening a book ───────────────────────────────────────────────────────
  /**
   * Weigh anchor on a book. With no chapter given, picks up exactly where the
   * listener left off, rewound by however much the time away warrants.
   */
  async open(
    book: Book,
    opts: { chapterIndex?: number; position?: number; autoplay?: boolean } = {}
  ): Promise<void> {
    const autoplay = opts.autoplay ?? true;
    const saved = this.progress.get(book.id);

    let index = opts.chapterIndex;
    let pos = opts.position;

    if (index == null) {
      index = Math.min(saved?.chapterIndex ?? 0, book.chapters.length - 1);
      if (pos == null) {
        pos = saved?.position ?? 0;
        // Smart rewind, scaled by how long the book has been sitting idle.
        const idle = Date.now() - (saved?.updatedAt ?? Date.now());
        pos = Math.max(0, pos - this.settings.rewindFor(idle));
      }
    }

    this.book.set(book);
    this.chapterIndex.set(Math.max(0, index));
    this.rate.set(this.rateFor(book.id));
    await this.load(pos ?? 0, autoplay);
  }

  /** Jump to a chapter within the open book. */
  async playChapter(index: number, position = 0): Promise<void> {
    const b = this.book();
    if (!b || index < 0 || index >= b.chapters.length) return;
    this.chapterIndex.set(index);
    await this.load(position, true);
  }

  /** Open a book straight at a bookmark (or note) position. */
  async jumpTo(book: Book, chapterIndex: number, position: number): Promise<void> {
    if (this.book()?.id === book.id) {
      await this.playChapter(chapterIndex, position);
    } else {
      await this.open(book, { chapterIndex, position, autoplay: true });
    }
  }

  private async load(seekTo: number, autoplay: boolean): Promise<void> {
    const token = ++this.loadToken;
    const chapter = this.chapter();
    if (!chapter) return;

    const start = chapter.start ?? 0;
    const length = chapter.end != null ? Math.max(0, chapter.end - start) : 0;
    // Landing in the last few seconds means "start this chapter over".
    const within = length > 0 && seekTo >= length - 3 ? 0 : Math.max(0, seekTo);

    this.silenceStart = -1;
    this.error.set(null);
    this.audio.volume = 1;

    // Jumping between chapters of the same file is a seek, not a load: the
    // bytes are already here, so there's nothing to fetch and nothing to wait
    // for. This is what makes a 30-hour .m4b feel instant.
    if (this.loadedFileId === chapter.fileId && this.audio.src) {
      this.audio.currentTime = start + within;
      this.lastTickTime = this.audio.currentTime;
      this.position.set(within);
      this.duration.set(this.windowLength());
      this.audio.playbackRate = this.rate();
      this.updateMediaMetadata();
      if (autoplay && this.audio.paused) {
        await this.audioCtx?.resume().catch(() => {});
        await this.audio.play().catch(() => {});
      }
      this.persist();
      void this.autoStow();
      return;
    }

    this.loading.set(true);
    this.position.set(within);
    this.lastTickTime = start + within;
    this.duration.set(chapter.duration ?? 0);
    this.downloadedBytes.set(0);
    this.downloadTotal.set(0);

    try {
      let url: string;
      if (this.preloaded?.id === chapter.fileId) {
        // Already fetched in the background while the last chapter played.
        url = this.preloaded.url;
        this.preloaded = null;
      } else {
        const media = await this.drive.getMedia(
          chapter.fileId,
          chapter.name,
          (loaded, total) => {
            // Ignore a superseded load's progress, or the bar jumps backwards.
            if (token !== this.loadToken) return;
            this.downloadedBytes.set(loaded);
            this.downloadTotal.set(total);
          },
          chapter.size ?? 0
        );
        url = media.url;

        if (token !== this.loadToken) {
          URL.revokeObjectURL(url); // a newer load overtook this one
          return;
        }
        // Keep what we just paid for. Coming back to a book tomorrow — or
        // after switching away and back — should start instantly, not
        // re-download the whole file. Eviction keeps the disk cost bounded.
        if (!media.fromCache && this.settings.keepPlayed()) {
          void this.offline.put(chapter.fileId, media.blob);
        }
      }

      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = url;
      this.loadedFileId = chapter.fileId;
      this.audio.src = url;
      this.audio.playbackRate = this.rate();

      if (start + within > 0) {
        const applySeek = () => {
          const d = this.audio.duration;
          const target = start + within;
          this.audio.currentTime = isFinite(d) && d > 0 ? Math.min(target, d) : target;
          this.lastTickTime = this.audio.currentTime;
          this.duration.set(this.windowLength());
          this.audio.removeEventListener('loadedmetadata', applySeek);
        };
        this.audio.addEventListener('loadedmetadata', applySeek);
      }

      this.updateMediaMetadata();
      await this.audioCtx?.resume().catch(() => {});
      if (autoplay) await this.audio.play();
      this.persist();
      void this.preloadNext();
      void this.autoStow();
    } catch (err: any) {
      if (token === this.loadToken) {
        this.loadedFileId = null;
        this.error.set(err?.message ?? 'Playback failed.');
        this.isPlaying.set(false);
      }
    } finally {
      if (token === this.loadToken) {
        this.loading.set(false);
        this.downloadedBytes.set(0);
        this.downloadTotal.set(0);
      }
    }
  }

  // ── transport ────────────────────────────────────────────────────────────
  togglePlay(): void {
    if (!this.book()) return;
    if (!this.audio.src) {
      // A session restored from storage hasn't fetched its audio yet.
      void this.load(this.position(), true);
      return;
    }
    if (this.audio.paused) {
      this.audio.volume = 1; // cancel any half-finished sleep fade
      void this.audio.play();
    } else {
      this.audio.pause();
    }
  }

  pause(): void {
    if (!this.audio.paused) this.audio.pause();
  }

  next(): void {
    this.advance(false);
  }

  prev(): void {
    // The familiar rule: restart the chapter unless you're right at the top.
    if (this.relativeNow() > 3) {
      this.seek(0);
      return;
    }
    if (this.hasPrev()) void this.playChapter(this.chapterIndex() - 1);
    else this.seek(0);
  }

  /** `seconds` is measured from the start of the *chapter*, not the file. */
  seek(seconds: number): void {
    if (!isFinite(seconds)) return;
    const start = this.windowStart();
    const length = this.windowLength();
    const rel = Math.max(0, length > 0 ? Math.min(seconds, length) : seconds);

    this.audio.currentTime = start + rel;
    this.lastTickTime = start + rel;
    this.position.set(rel);
    this.persist();
  }

  skip(deltaSeconds: number): void {
    if (!this.audio.src) return;
    const target = this.relativeNow() + deltaSeconds;
    const length = this.windowLength();

    // Skipping off either end of a chapter rolls into the neighbouring one.
    if (length > 0 && target > length && this.hasNext()) {
      void this.playChapter(this.chapterIndex() + 1, 0);
      return;
    }
    if (target < 0 && this.hasPrev()) {
      void this.playChapter(this.chapterIndex() - 1, 0);
      return;
    }
    this.seek(target);
  }

  back(): void {
    this.skip(-this.settings.skipBack());
  }

  forward(): void {
    this.skip(this.settings.skipForward());
  }

  /**
   * Playing an .m4b, the audio runs straight through the chapter boundaries —
   * there is nothing to load and no gap to cover. We just slide the chapter
   * index forward as the playhead passes each marker, which keeps the title,
   * the scrubber and the lock screen honest without touching playback.
   */
  private checkChapterBoundary(rawTime: number): void {
    const book = this.book();
    const current = this.chapter();
    if (!book || !current || current.end == null) return;
    if (rawTime < current.end - 0.05) return;

    const next = book.chapters[this.chapterIndex() + 1];
    // The last chapter of a file just runs out; `ended` handles that.
    if (!next || next.fileId !== current.fileId) return;

    this.progress.markChapterComplete(book.id, current.id);

    if (this.stopAtChapterEnd()) {
      this.audio.pause();
      this.clearSleep();
      return;
    }
    if (!this.settings.continuousPlay()) {
      this.audio.pause();
      return;
    }

    this.chapterIndex.set(next.index);
    this.position.set(Math.max(0, rawTime - (next.start ?? 0)));
    this.duration.set(this.windowLength());
    this.updateMediaMetadata();
    this.persist();
  }

  private onChapterEnded(): void {
    const b = this.book();
    const c = this.chapter();
    if (b && c) this.progress.markChapterComplete(b.id, c.id);

    if (this.stopAtChapterEnd()) {
      this.clearSleep();
      this.audio.pause();
      return;
    }
    this.advance(true);
  }

  private advance(auto: boolean): void {
    const b = this.book();
    if (!b) return;

    if (this.hasNext()) {
      if (auto && !this.settings.continuousPlay()) {
        this.isPlaying.set(false);
        return;
      }
      void this.playChapter(this.chapterIndex() + 1, 0);
      return;
    }

    // Only *playing out* the last chapter finishes a book. Tapping "next" at
    // the end shouldn't stamp it done when there's still audio unheard.
    if (auto) this.progress.markFinished(b.id, true);
    this.isPlaying.set(false);
    this.audio.pause();
  }

  // ── speed ────────────────────────────────────────────────────────────────
  private readRates(): Record<string, number> {
    try {
      const raw = localStorage.getItem(RATES_KEY);
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  }

  private rateFor(bookId: string): number {
    if (!this.settings.perBookRate()) return this.settings.defaultRate();
    return this.perBookRates[bookId] ?? this.settings.defaultRate();
  }

  setRate(rate: number): void {
    const r = Math.min(4, Math.max(0.25, rate));
    this.rate.set(r);
    const b = this.book();
    if (b && this.settings.perBookRate()) {
      this.perBookRates[b.id] = r;
      try {
        localStorage.setItem(RATES_KEY, JSON.stringify(this.perBookRates));
      } catch {
        /* ignore */
      }
    } else {
      this.settings.defaultRate.set(r);
    }
  }

  nudgeRate(delta: number): void {
    this.setRate(Math.round((this.rate() + delta) * 100) / 100);
  }

  // ── sleep timer (Davy Jones' Locker) ─────────────────────────────────────
  setSleepTimer(minutes: number): void {
    this.clearSleep();
    const ms = minutes * 60_000;
    this.sleepEndsAt.set(Date.now() + ms);

    const fade = this.settings.sleepFade();
    const fadeAt = Math.max(0, ms - FADE_SECONDS * 1000);

    this.sleepHandle = setTimeout(
      () => {
        if (fade) this.startFade();
        else {
          this.audio.pause();
          this.clearSleep();
        }
      },
      fade ? fadeAt : ms
    );
  }

  /** Sleep at the end of the current chapter instead of on the clock. */
  setSleepChapterEnd(): void {
    this.clearSleep();
    this.stopAtChapterEnd.set(true);
  }

  /** "Still awake?" — push the timer back without re-picking a duration. */
  extendSleep(minutes = 10): void {
    const end = this.sleepEndsAt();
    const base = end && end > Date.now() ? (end - Date.now()) / 60_000 : 0;
    this.audio.volume = 1;
    this.setSleepTimer(base + minutes);
  }

  clearSleep(): void {
    if (this.sleepHandle) {
      clearTimeout(this.sleepHandle);
      this.sleepHandle = null;
    }
    if (this.fadeHandle) {
      clearInterval(this.fadeHandle);
      this.fadeHandle = null;
    }
    this.audio.volume = 1;
    this.sleepEndsAt.set(null);
    this.stopAtChapterEnd.set(false);
  }

  /** Ease the volume down so the story drifts off rather than snapping shut. */
  private startFade(): void {
    if (this.fadeHandle) clearInterval(this.fadeHandle);
    const steps = FADE_SECONDS * 4;
    let n = 0;
    this.fadeHandle = setInterval(() => {
      n++;
      this.audio.volume = Math.max(0, 1 - n / steps);
      if (n >= steps) {
        this.audio.pause();
        this.clearSleep();
      }
    }, 250);
  }

  // ── persistence ──────────────────────────────────────────────────────────
  private persist(): void {
    this.lastPersist = Date.now();
    const b = this.book();
    const c = this.chapter();

    if (b && c) {
      const listened = this.pendingListened;
      this.pendingListened = 0;
      // Positions are always stored relative to the chapter, so a bookmark in
      // an .m4b means the same thing whether or not the markers get re-read.
      const at = this.audio.src ? this.relativeNow() : this.position();

      this.progress.record(
        b.id,
        this.chapterIndex(),
        c.id,
        at,
        this.duration(),
        listened
      );
      if (listened > 0) this.stats.add(listened, b.id, b.title);

      try {
        const data: StoredPlayback = {
          bookId: b.id,
          chapterIndex: this.chapterIndex(),
          position: at,
          leftAt: Date.now(),
        };
        localStorage.setItem(PLAYBACK_KEY, JSON.stringify(data));
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Bring back the last session's book without fetching audio — the listener
   * sees the mini-player where they left it and playback starts on their tap,
   * which is also what browser autoplay policies insist on.
   */
  private restore(): void {
    try {
      const raw = localStorage.getItem(PLAYBACK_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as StoredPlayback;
      const book = this.library.get(s.bookId);
      if (!book || !book.chapters.length) return;

      const index = Math.min(s.chapterIndex ?? 0, book.chapters.length - 1);
      const rewind = this.settings.rewindFor(Date.now() - (s.leftAt ?? Date.now()));

      this.book.set(book);
      this.chapterIndex.set(index);
      this.position.set(Math.max(0, (s.position ?? 0) - rewind));
      this.lastTickTime = this.position();
      this.rate.set(this.rateFor(book.id));

      const chapter = book.chapters[index];
      const known =
        this.progress.get(book.id)?.durations[chapter.id] ?? chapter.duration;
      if (known) this.duration.set(known);
    } catch {
      /* ignore */
    }
  }

  /** Called by the shelf after a sync so the restored book picks up new chapters. */
  refreshOpenBook(): void {
    const b = this.book();
    if (!b) return;
    const fresh = this.library.get(b.id);
    if (fresh) this.book.set(fresh);
  }

  /** Close the book without losing the saved position. */
  close(): void {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.loadedFileId = null;
    this.book.set(null);
    this.chapterIndex.set(-1);
    this.position.set(0);
    this.duration.set(0);
    this.clearSleep();
    try {
      localStorage.removeItem(PLAYBACK_KEY);
    } catch {
      /* ignore */
    }
  }

  // ── preload / auto-stow ──────────────────────────────────────────────────
  private async preloadNext(): Promise<void> {
    const b = this.book();
    const cur = this.chapter();
    if (!b || !cur || !this.hasNext()) return;

    const nextChapter = b.chapters[this.chapterIndex() + 1];
    if (!nextChapter) return;
    // Nothing to fetch when the next chapter is further into the same file.
    if (nextChapter.fileId === cur.fileId) return;
    if (this.preloaded?.id === nextChapter.fileId) return;

    try {
      const url = await this.drive.getObjectUrl(nextChapter.fileId, nextChapter.name);
      if (this.preloaded) URL.revokeObjectURL(this.preloaded.url);
      this.preloaded = { id: nextChapter.fileId, url };
    } catch {
      /* best-effort */
    }
  }

  /** Keep a chapter or two ahead in the hold, for the commute into a tunnel. */
  private async autoStow(): Promise<void> {
    if (!this.settings.autoStowNext()) return;
    const b = this.book();
    if (!b) return;
    // Look *ahead*: the file playing right now was already stowed straight from
    // the playback download. Deduplicated too, since an .m4b's chapters all
    // live in one file and would otherwise queue the same fetch three times.
    const current = this.chapter()?.fileId;
    const i = this.chapterIndex();
    const ids = [
      ...new Set(b.chapters.slice(i + 1, i + 4).map((c) => c.fileId)),
    ].filter((id) => id !== current);
    for (const id of ids) {
      try {
        // Read-ahead is a convenience, not a promise — leave it unpinned so
        // it can be evicted before anything the listener chose to download.
        await this.offline.download(id, false);
      } catch {
        /* ignore */
      }
    }
  }

  // ── Web Audio (boost + skip silence + voice enhancement) ─────────────────
  /*
   * Chain: source → highpass → mud-cut → presence → compressor → gain →
   * analyser → destination. The three filters and the compressor sit inline
   * always, but stay flat (no-op) until "Enhance voice" turns them on, so
   * there's no audible change unless the listener asks for it.
   */
  private ensureAudioGraph(): void {
    if (this.audioCtx) return;
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx: AudioContext = new Ctx();
      this.audioCtx = ctx;

      const src = ctx.createMediaElementSource(this.audio);

      this.highpass = ctx.createBiquadFilter();
      this.highpass.type = 'highpass';

      this.mudCut = ctx.createBiquadFilter();
      this.mudCut.type = 'peaking';
      this.mudCut.frequency.value = 350; // boxy low-mids
      this.mudCut.Q.value = 1;

      this.presence = ctx.createBiquadFilter();
      this.presence.type = 'peaking';
      this.presence.frequency.value = 3000; // consonant clarity
      this.presence.Q.value = 0.9;

      this.compressor = ctx.createDynamicsCompressor();

      this.gainNode = ctx.createGain();

      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;

      src.connect(this.highpass);
      this.highpass.connect(this.mudCut);
      this.mudCut.connect(this.presence);
      this.presence.connect(this.compressor);
      this.compressor.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      this.analyser.connect(ctx.destination);

      this.applyEnhance();
      this.updateGain();
    } catch {
      this.audioCtx = null;
    }
  }

  /** Set the enhancement nodes to their active or flat (no-op) values. */
  private applyEnhance(): void {
    if (!this.audioCtx || !this.highpass) return;
    const on = this.settings.enhanceVoice();
    const t = this.audioCtx.currentTime;
    const ramp = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.02);

    ramp(this.highpass.frequency, on ? 85 : 20); // 20 Hz ≈ inaudible = off
    ramp(this.mudCut!.gain, on ? -3 : 0);
    ramp(this.presence!.gain, on ? 5 : 0);

    const c = this.compressor!;
    ramp(c.threshold, on ? -24 : 0);
    ramp(c.ratio, on ? 3 : 1); // ratio 1 = no compression
    ramp(c.knee, on ? 30 : 0);
    ramp(c.attack, 0.005);
    ramp(c.release, 0.25);
  }

  /** Combined output gain: the volume boost, plus makeup when enhancing. */
  private updateGain(): void {
    if (!this.gainNode || !this.audioCtx) return;
    // Compression tames peaks, so lift the level a touch to keep it from
    // sounding quieter than the unprocessed audio.
    const makeup = this.settings.enhanceVoice() ? 1.5 : 1;
    this.gainNode.gain.setTargetAtTime(
      this.settings.boost() * makeup,
      this.audioCtx.currentTime,
      0.02
    );
  }

  /**
   * Nudge past the dead air between sentences. The threshold is deliberately
   * short — narration gaps are what we're clipping, not dramatic pauses, and
   * stepping rather than jumping keeps it from sounding chopped.
   */
  private startSilenceLoop(): void {
    if (!this.settings.skipSilence() || !this.analyser || this.silenceRAF != null) {
      return;
    }
    const buf = new Uint8Array(this.analyser.fftSize);
    const tick = () => {
      if (!this.settings.skipSilence() || !this.analyser || this.audio.paused) {
        this.silenceRAF = null;
        return;
      }
      this.analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const c = (v - 128) / 128;
        sum += c * c;
      }
      const rms = Math.sqrt(sum / buf.length);
      const t = this.audio.currentTime;

      if (rms >= SILENCE_RMS) {
        this.silenceStart = -1;
      } else {
        if (this.silenceStart < 0 || t < this.silenceStart) this.silenceStart = t;
        if (
          t - this.silenceStart > SILENCE_SKIP_AFTER &&
          t < this.audio.duration - 1
        ) {
          this.audio.currentTime += SILENCE_STEP;
        }
      }
      this.silenceRAF = requestAnimationFrame(tick);
    };
    this.silenceRAF = requestAnimationFrame(tick);
  }

  // ── screen wake lock ─────────────────────────────────────────────────────
  private async acquireWakeLock(): Promise<void> {
    if (!this.settings.keepAwake()) return;
    try {
      const nav = navigator as any;
      if (!nav.wakeLock || this.wakeLock) return;
      this.wakeLock = await nav.wakeLock.request('screen');
      this.wakeLock.addEventListener?.('release', () => {
        this.wakeLock = null;
      });
    } catch {
      /* denied or unsupported — harmless */
    }
  }

  private releaseWakeLock(): void {
    try {
      this.wakeLock?.release?.();
    } catch {
      /* ignore */
    }
    this.wakeLock = null;
  }

  // ── Media Session (lock screen, car stereo, headset buttons) ─────────────
  private setupMediaSession(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* action unsupported on this platform */
      }
    };
    set('play', () => this.togglePlay());
    set('pause', () => this.togglePlay());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekbackward', (d) => this.skip(-(d.seekOffset || this.settings.skipBack())));
    set('seekforward', (d) => this.skip(d.seekOffset || this.settings.skipForward()));
    set('seekto', (d) => {
      if (d.seekTime != null) this.seek(d.seekTime);
    });
    set('stop', () => this.pause());
  }

  private updateMediaMetadata(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const b = this.book();
    const c = this.chapter();
    if (!b || !c) return;

    const art = this.library.cover(b.id) || this.crest.dataUrl(b.id, 512, b.title);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: c.title,
      artist: b.author || 'Unknown author',
      album: b.title,
      artwork: art ? [{ src: art, sizes: '512x512', type: 'image/png' }] : [],
    });
  }

  private updatePositionState(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const d = this.audio.duration;
    if (!isFinite(d) || d <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        position: Math.min(this.audio.currentTime, d),
        playbackRate: this.audio.playbackRate || 1,
      });
    } catch {
      /* ignore */
    }
  }

  private setPlaybackState(state: 'playing' | 'paused'): void {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state;
    }
  }
}
