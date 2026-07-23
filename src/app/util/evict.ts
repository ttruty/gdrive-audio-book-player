export interface Evictable {
  id: string;
  /** Bytes. 0 when we never learned the real size. */
  size: number;
  /** Millis. */
  lastUsed: number;
  /** Explicitly downloaded — never evicted to make room. */
  pinned: boolean;
}

/**
 * Decide which cached files to drop so the total fits `budgetBytes`.
 *
 * Least-recently-used first, and only ever files the listener didn't
 * explicitly download. A library of pinned books can legitimately exceed the
 * budget — the budget governs what playback *kept on its own*, not what
 * someone asked for. A budget of 0 means no limit.
 *
 * Returns the ids to remove, oldest first.
 */
export function selectForEviction(
  entries: Evictable[],
  budgetBytes: number
): string[] {
  if (budgetBytes <= 0) return [];

  let total = entries.reduce((n, e) => n + (e.size || 0), 0);
  if (total <= budgetBytes) return [];

  const victims = entries
    .filter((e) => !e.pinned)
    .sort((a, b) => a.lastUsed - b.lastUsed);

  const doomed: string[] = [];
  for (const e of victims) {
    if (total <= budgetBytes) break;
    doomed.push(e.id);
    total -= e.size || 0;
  }
  return doomed;
}
