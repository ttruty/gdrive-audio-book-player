import { Injectable, computed, signal } from '@angular/core';
import { DayStat } from '../models';
import { dayKey } from '../util/format';

const STORAGE_KEY = 'yarnbeard.stats.v1';
/** Two years of daily rows is plenty; older ones get rolled off. */
const MAX_DAYS = 730;

/**
 * The ship's log of time at sea: seconds listened per day, plus the streak
 * that quietly nags you into finishing the book.
 */
@Injectable({ providedIn: 'root' })
export class StatsService {
  readonly days = signal<DayStat[]>(this.read());

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

  private read(): DayStat[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? (JSON.parse(raw) as DayStat[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.days()));
    } catch {
      /* ignore */
    }
  }

  /** Add listened seconds to today's tally. Called from the player's ticker. */
  add(seconds: number): void {
    if (!isFinite(seconds) || seconds <= 0) return;
    const key = dayKey();
    this.days.update((list) => {
      const idx = list.findIndex((d) => d.date === key);
      const next =
        idx >= 0
          ? list.map((d, i) =>
              i === idx ? { ...d, seconds: d.seconds + seconds } : d
            )
          : [...list, { date: key, seconds }];
      next.sort((a, b) => a.date.localeCompare(b.date));
      return next.slice(-MAX_DAYS);
    });
    this.write();
  }

  clear(): void {
    this.days.set([]);
    this.write();
  }

  // ── sync plumbing ────────────────────────────────────────────────────────
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
    this.write();
  }

  replaceAll(list: DayStat[]): void {
    this.days.set(Array.isArray(list) ? list : []);
    this.write();
  }
}
