// Shared keyset-pagination helpers. Every interactive query is bounded by
// MAX_PAGE_SIZE and returns a `nextCursor` for the following page (FR-003/004).

import { MAX_PAGE_SIZE, type Keyset, type Page } from './types';

/** Clamps a requested page size into [1, MAX_PAGE_SIZE]. */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return 1;
  }
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
}

/**
 * Turns `limit + 1` fetched rows into a bounded page: if an extra row was read,
 * the last kept row's keyset becomes the next cursor; otherwise the page is the
 * end of the list.
 */
export function toPage<T>(rows: T[], limit: number, cursorOf: (row: T) => Keyset): Page<T> {
  if (rows.length <= limit) {
    return { items: rows, nextCursor: null };
  }
  const items = rows.slice(0, limit);
  return { items, nextCursor: cursorOf(items[items.length - 1]) };
}
