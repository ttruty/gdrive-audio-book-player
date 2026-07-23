/* Small formatting helpers shared across pages. */

/** 0:00 / 1:02:03 — omits the hours field when there aren't any. */
export function hhmmss(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "4h 12m" / "12m" / "40s" — for durations read at a glance. */
export function humanDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "just now" / "3h ago" / "12 Aug" — relative for the last week, date after. */
export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

export function bytes(n: number | null | undefined): string {
  const b = Number(n) || 0;
  if (b <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Local "YYYY-MM-DD" — the key used for daily listening stats. */
export function dayKey(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Turn "03 - The Black Spot.mp3" into "The Black Spot".
 * Leading track numbers, common separators and the extension all come off;
 * if that would leave nothing, we keep the original filename.
 */
export function chapterTitle(filename: string): string {
  let t = (filename || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  t = t.replace(/^[\s_\-.]*\d{1,4}\s*[-–—_.)\]]*\s*/, '');
  t = t.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t || filename.replace(/\.[a-z0-9]{1,5}$/i, '') || filename;
}

/**
 * Split a folder name into author + title when it uses the common
 * "Author - Title" or "Title (Author)" shapes. Falls back to title-only.
 */
export function parseFolderTitle(folderName: string): {
  title: string;
  author?: string;
} {
  const name = (folderName || '').trim();
  const dash = name.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/);
  if (dash) {
    // "Robert Louis Stevenson - Treasure Island"
    return { author: dash[1].trim(), title: dash[2].trim() };
  }
  const paren = name.match(/^(.{2,})\s*[\(\[]([^)\]]{2,60})[\)\]]\s*$/);
  if (paren) {
    return { title: paren[1].trim(), author: paren[2].trim() };
  }
  return { title: name };
}

/** Natural sort so "Chapter 2" lands before "Chapter 10". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
