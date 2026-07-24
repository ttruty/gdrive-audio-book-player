import { Injectable, computed, signal } from '@angular/core';
import { DayStat, Session } from '../models';
import { dayKey, newId } from '../util/format';

const STORAGE_KEY = 'yarnbeard.stats.v1';
const SESSIONS_KEY = 'yarnbeard.sessions.v1';
/** Two years of daily rows is plenty; older ones get rolled off. */
const MAX_DAYS = 730;
/** Keep session detail bounded — the daily totals cover the long tail. */
const MAX_SESSIONS = 1500;
/**
 * A pause longer than this starts a fresh session rather than extending the
 * last one, so "session time" reflects an actual sitting.
 */
const SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * The ship's log of time at sea: seconds listened per day, the streak that
 * quietly nags you into finishing the book, and a record of individual
 * sessions so the stats can show what was actually played and for how long.
 *
 * Sessions are kept on this device only — the synced daily totals carry the
 * aggregate across devices, but the per-session breakdown is local.
 */
@Injectable({ providedIn: 'root' })
export class StatsService {
  readonly days = signal<DayStat[]>(this.readDays());
  readonly sessions = signal<Session[]>(this.readSessions());

  readonly today = computed(() => {
    const k = dayKey();
    return this.days().find((d) => d.date === k)?.seconds ?? 0;
  });

  readonly totalSeconds = computed(() =>
    this.days().reduce((sum, d) => sum + d.seconds, 0)
  );

  /** Consecutive days with any listening, counting back from today (or yesterday). */
  readonly streak = computed(() => {
    const set = new Map(this.days().map((d) => [d.date, d.seconds]));
    const cursor = new Date();
    // A streak survives until the end of today, so start from yesterday if
    // nothing has been played yet.
    if (!(set.get(dayKey(cursor)) ?? 0)) cursor.setDate(cursor.getDate() - 1);

    let n = 0;
    for (;;) {
      if ((set.get(dayKey(cursor)) ?? 0) <= 0) break;
      n++;
      cursor.setDate(cursor.getDate() - 1);
      if (n > MAX_DAYS) break;
    }
    return n;
  });

  /** Last `n` days oldest-first, zero-filled — ready to draw as bars. */
  recentDays(n = 14): DayStat[] {
    const set = new Map(this.days().map((d) => [d.date, d.seconds]));
    const out: DayStat[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dayKey(d);
      out.push({ date: key, seconds: set.get(key) ?? 0 });
    }
    return out;
  }

  /** The sessions recorded on a given day, most recent first. */
  sessionsForDay(date: string): Session[] {
    return this.sessions()
      .filter((s) => s.date === date)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * What was listened to on a day, one row per book with the time summed and
   * a count of sittings — the "what did I listen to" answer.
   */
  booksForDay(date: string): { bookId: string; title: string; seconds: number; sessions: number }[] {
    const byBook = new Map<string, { bookId: string; title: string; seconds: number; sessions: number }>();
    for (const s of this.sessionsForDay(date)) {
      const cur = byBook.get(s.bookId);
      if (cur) {
        cur.seconds += s.seconds;
        cur.sessions += 1;
      } else {
        byBook.set(s.bookId, {
          bookId: s.bookId,
          title: s.bookTitle,
          seconds: s.seconds,
          sessions: 1,
        });
      }
    }
    return [...byBook.values()].sort((a, b) => b.seconds - a.seconds);
  }

  // ── storage ──────────────────────────────────────────────────────────────
  private readDays(): DayStat[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? (JSON.parse(raw) as DayStat[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private writeDays(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.days()));
    } catch {
      /* ignore */
    }
  }

  private readSessions(): Session[] {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      const list = raw ? (JSON.parse(raw) as Session[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private writeSessions(): void {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(this.sessions()));
    } catch {
      /* ignore */
    }
  }

  /**
   * Add listened seconds. Called from the player's ticker. The daily total
   * always updates; when a book is given, the seconds also extend the current
   * session for that book (or open a new one after a long enough gap).
   */
  add(seconds: number, bookId?: string, bookTitle?: string): void {
    if (!isFinite(seconds) || seconds <= 0) return;

    const key = dayKey();
    this.days.update((list) => {
      const idx = list.findIndex((d) => d.date === key);
      const next =
        idx >= 0
          ? list.map((d, i) => (i === idx ? { ...d, seconds: d.seconds + seconds } : d))
          : [...list, { date: key, seconds }];
      next.sort((a, b) => a.date.localeCompare(b.date));
      return next.slice(-MAX_DAYS);
    });
    this.writeDays();

    if (bookId) this.recordSession(seconds, bookId, bookTitle ?? 'A book');
  }

  private recordSession(seconds: number, bookId: string, bookTitle: string): void {
    const now = Date.now();
    this.sessions.update((list) => {
      const last = list.length ? list[list.length - 1] : null;
      // Extend the live session when it's the same book, same day, and the
      // gap since the last tick is short enough to count as one sitting.
      if (
        last &&
        last.bookId === bookId &&
        last.date === dayKey() &&
        now - last.endedAt <= SESSION_GAP_MS
      ) {
        const updated: Session = {
          ...last,
          endedAt: now,
          seconds: last.seconds + seconds,
          // Keep the freshest title in case the book was renamed mid-session.
          bookTitle,
        };
        return [...list.slice(0, -1), updated];
      }
      const fresh: Session = {
        id: newId(),
        bookId,
        bookTitle,
        date: dayKey(),
        startedAt: now - Math.round(seconds * 1000),
        endedAt: now,
        seconds,
      };
      return [...list, fresh].slice(-MAX_SESSIONS);
    });
    this.writeSessions();
  }

  clear(): void {
    this.days.set([]);
    this.sessions.set([]);
    this.writeDays();
    this.writeSessions();
  }

  // ── sync plumbing (daily totals only; sessions stay local) ────────────────
  snapshot(): DayStat[] {
    return this.days();
  }

  /**
   * Take the larger count per day. Two devices listening on the same day can't
   * be added without double-counting a synced session, and the max is the
   * closest honest answer.
   */
  merge(incoming: DayStat[] | undefined): void {
    if (!Array.isArray(incoming) || !incoming.length) return;
    this.days.update((mine) => {
      const byDate = new Map(mine.map((d) => [d.date, d.seconds]));
      for (const d of incoming) {
        byDate.set(d.date, Math.max(byDate.get(d.date) ?? 0, d.seconds ?? 0));
      }
      return [...byDate.entries()]
        .map(([date, seconds]) => ({ date, seconds }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-MAX_DAYS);
    });
    this.writeDays();
  }

  replaceAll(list: DayStat[]): void {
    this.days.set(Array.isArray(list) ? list : []);
    this.writeDays();
  }
}
