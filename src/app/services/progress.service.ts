import { Injectable, signal } from '@angular/core';
import { Book, BookProgress } from '../models';

const STORAGE_KEY = 'yarnbeard.progress.v1';
/** Within this many seconds of the end counts as "played out". */
const DONE_TAIL = 20;

/**
 * Where the listener left off in every book — the thing an audiobook player
 * lives or dies by. Keyed by Drive folder id, so re-scanning a book or opening
 * it on another device lands on the same page.
 */
@Injectable({ providedIn: 'root' })
export class ProgressService {
  readonly map = signal<Record<string, BookProgress>>(this.read());

  private read(): Record<string, BookProgress> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, BookProgress>) : {};
      // Older/partial records shouldn't crash the shelf.
      for (const p of Object.values(parsed)) {
        p.durations ??= {};
        p.completed ??= [];
        p.listened ??= 0;
      }
      return parsed;
    } catch {
      return {};
    }
  }

  private write(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.map()));
    } catch {
      /* ignore */
    }
  }

  get(bookId: string): BookProgress | undefined {
    return this.map()[bookId];
  }

  private blank(bookId: string): BookProgress {
    return {
      bookId,
      chapterIndex: 0,
      position: 0,
      durations: {},
      completed: [],
      updatedAt: Date.now(),
      listened: 0,
    };
  }

  private patch(bookId: string, fn: (p: BookProgress) => BookProgress): void {
    this.map.update((m) => {
      const current = m[bookId] ?? this.blank(bookId);
      return { ...m, [bookId]: { ...fn(current), updatedAt: Date.now() } };
    });
    this.write();
  }

  /** Called steadily while playing. `listenedDelta` is real seconds heard. */
  record(
    bookId: string,
    chapterIndex: number,
    chapterId: string,
    position: number,
    duration: number,
    listenedDelta = 0
  ): void {
    if (!bookId || !isFinite(position)) return;
    this.patch(bookId, (p) => {
      const durations = { ...p.durations };
      if (duration > 0 && isFinite(duration)) durations[chapterId] = duration;
      return {
        ...p,
        chapterIndex,
        position,
        durations,
        listened: p.listened + Math.max(0, listenedDelta),
      };
    });
  }

  markChapterComplete(bookId: string, chapterId: string): void {
    this.patch(bookId, (p) =>
      p.completed.includes(chapterId)
        ? p
        : { ...p, completed: [...p.completed, chapterId] }
    );
  }

  markChapterUnplayed(bookId: string, chapterId: string): void {
    this.patch(bookId, (p) => ({
      ...p,
      completed: p.completed.filter((id) => id !== chapterId),
    }));
  }

  isChapterComplete(bookId: string, chapterId: string): boolean {
    return !!this.get(bookId)?.completed.includes(chapterId);
  }

  markFinished(bookId: string, finished = true): void {
    this.patch(bookId, (p) => ({
      ...p,
      finishedAt: finished ? Date.now() : undefined,
    }));
  }

  isFinished(bookId: string): boolean {
    return !!this.get(bookId)?.finishedAt;
  }

  /** Back to page one. */
  reset(bookId: string): void {
    this.map.update((m) => {
      const next = { ...m };
      delete next[bookId];
      return next;
    });
    this.write();
  }

  /** True once a position sits inside the tail of its chapter. */
  atChapterEnd(position: number, duration: number): boolean {
    return duration > 0 && position >= duration - DONE_TAIL;
  }

  /** Whether the listener has actually started this book. */
  isStarted(bookId: string): boolean {
    const p = this.get(bookId);
    return !!p && (p.chapterIndex > 0 || p.position > 30 || p.completed.length > 0);
  }

  /**
   * Total seconds of a book, using measured chapter durations and estimating
   * the rest from the average of what we do know (a fresh book has none, so
   * callers should treat 0 as "unknown" and fall back to chapter counts).
   */
  totalDuration(book: Book): number {
    const p = this.get(book.id);
    const known = book.chapters
      .map((c) => p?.durations[c.id] ?? c.duration ?? 0)
      .filter((d) => d > 0);
    if (!known.length) return 0;
    const avg = known.reduce((a, b) => a + b, 0) / known.length;
    return book.chapters.reduce((sum, c) => {
      const d = p?.durations[c.id] ?? c.duration ?? 0;
      return sum + (d > 0 ? d : avg);
    }, 0);
  }

  /** Seconds elapsed from the start of the book to the current position. */
  elapsed(book: Book): number {
    const p = this.get(book.id);
    if (!p) return 0;
    if (p.finishedAt) return this.totalDuration(book);

    const known = book.chapters
      .map((c) => p.durations[c.id] ?? c.duration ?? 0)
      .filter((d) => d > 0);
    const avg = known.length
      ? known.reduce((a, b) => a + b, 0) / known.length
      : 0;

    let sum = 0;
    for (let i = 0; i < Math.min(p.chapterIndex, book.chapters.length); i++) {
      const c = book.chapters[i];
      const d = p.durations[c.id] ?? c.duration ?? 0;
      sum += d > 0 ? d : avg;
    }
    return sum + Math.max(0, p.position);
  }

  /** 0–1. Falls back to chapter position when no durations are known yet. */
  percent(book: Book): number {
    const p = this.get(book.id);
    if (!p) return 0;
    if (p.finishedAt) return 1;
    const total = this.totalDuration(book);
    if (total > 0) return Math.min(1, this.elapsed(book) / total);
    if (!book.chapters.length) return 0;
    return Math.min(1, p.chapterIndex / book.chapters.length);
  }

  /** Seconds left, or 0 when we can't tell yet. */
  remaining(book: Book): number {
    const total = this.totalDuration(book);
    if (total <= 0) return 0;
    return Math.max(0, total - this.elapsed(book));
  }

  // ── sync plumbing ────────────────────────────────────────────────────────
  snapshot(): Record<string, BookProgress> {
    return this.map();
  }

  /** Last-write-wins per book, which is the right call for a reading position. */
  merge(incoming: Record<string, BookProgress> | undefined): void {
    if (!incoming) return;
    this.map.update((mine) => {
      const next = { ...mine };
      for (const [id, theirs] of Object.entries(incoming)) {
        const ours = next[id];
        if (!ours || (theirs?.updatedAt ?? 0) > (ours.updatedAt ?? 0)) {
          next[id] = {
            ...theirs,
            durations: theirs.durations ?? {},
            completed: theirs.completed ?? [],
            listened: theirs.listened ?? 0,
          };
        }
      }
      return next;
    });
    this.write();
  }

  replaceAll(data: Record<string, BookProgress>): void {
    this.map.set(data ?? {});
    this.write();
  }
}
