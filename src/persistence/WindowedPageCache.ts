// Bounded, keyset-driven page cache (FR-005, research R12). Holds at most
// `maxPages` materialized pages as a sliding window over a longer list; scrolling
// past the cap evicts the far edge, and scrolling back re-fetches the evicted
// page by its retained cursor. Eviction never reorders retained pages, so scroll
// anchors are preserved. This is the reusable mechanism the live conversation
// store wires into for conversation lists and per-conversation message history.

import type { Keyset, Page } from './types';

/** Fetches one page starting after `before` (null = first page). */
export type PageFetcher<T> = (before: Keyset | null) => Page<T>;

export class WindowedPageCache<T> {
  /** Start cursor of every page ever loaded (index = page number); survives eviction. */
  private readonly boundaries: (Keyset | null)[] = [];
  private firstPageIndex = 0;
  private pages: Page<T>[] = [];

  constructor(private readonly maxPages: number) {
    if (maxPages < 1) {
      throw new Error('WindowedPageCache requires maxPages >= 1.');
    }
  }

  /** Resets the window and loads the first page. */
  loadFirst(loadPage: PageFetcher<T>): void {
    this.boundaries.length = 0;
    this.boundaries.push(null);
    this.firstPageIndex = 0;
    this.pages = [loadPage(null)];
  }

  /** Loads the next page; evicts the head if the window is full. Returns false at the end. */
  loadNext(loadPage: PageFetcher<T>): boolean {
    if (this.pages.length === 0) {
      return false;
    }
    const tail = this.pages[this.pages.length - 1];
    if (tail.nextCursor === null) {
      return false;
    }
    const nextIndex = this.firstPageIndex + this.pages.length;
    this.boundaries[nextIndex] = tail.nextCursor;
    this.pages.push(loadPage(tail.nextCursor));
    if (this.pages.length > this.maxPages) {
      this.pages.shift();
      this.firstPageIndex += 1;
    }
    return true;
  }

  /** Re-fetches the page above the window head; evicts the tail if full. Returns false at the top. */
  loadPrevious(loadPage: PageFetcher<T>): boolean {
    if (this.firstPageIndex === 0) {
      return false;
    }
    const previousIndex = this.firstPageIndex - 1;
    this.pages.unshift(loadPage(this.boundaries[previousIndex]));
    this.firstPageIndex = previousIndex;
    if (this.pages.length > this.maxPages) {
      this.pages.pop();
    }
    return true;
  }

  /** Flattened items currently held in the window, in order. */
  items(): T[] {
    return this.pages.flatMap((page) => page.items as T[]);
  }

  pageCount(): number {
    return this.pages.length;
  }

  /** Zero-based index of the first materialized page (rises as the head is evicted). */
  windowStart(): number {
    return this.firstPageIndex;
  }

  hasMore(): boolean {
    const tail = this.pages[this.pages.length - 1];
    return tail !== undefined && tail.nextCursor !== null;
  }

  /** Whether a page before the current window can be re-fetched. */
  hasPrevious(): boolean {
    return this.firstPageIndex > 0;
  }
}
