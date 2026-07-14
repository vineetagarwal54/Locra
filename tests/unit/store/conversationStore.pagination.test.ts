// T017 — bounded page cache: at most 2 conversation-list pages and 3 message
// pages per active conversation; eviction preserves anchors and re-fetches
// evicted pages by cursor (FR-005, research R12).

import { ConversationRepository } from '../../../src/persistence/ConversationRepository';
import { MessageRepository } from '../../../src/persistence/MessageRepository';
import type { Keyset, Page } from '../../../src/persistence/types';
import { WindowedPageCache } from '../../../src/persistence/WindowedPageCache';
import {
  CONVERSATION_LIST_MAX_PAGES,
  MESSAGE_MAX_PAGES,
  createConversationListCache,
  createMessageHistoryCache,
  loadMoreConversations,
  loadOlderMessages,
} from '../../../src/store/conversationHistoryCache';
import { createTestDatabase, type TestDatabase } from '../../helpers/nodeSqliteDriver';

/** Synthetic paged data source over a fixed list, for precise eviction assertions. */
function arrayFetcher(values: number[], pageSize: number) {
  const calls: (Keyset | null)[] = [];
  const fetch = (before: Keyset | null): Page<number> => {
    calls.push(before);
    const start = before === null ? 0 : before.ts;
    const slice = values.slice(start, start + pageSize);
    const nextIndex = start + pageSize;
    const nextCursor = nextIndex < values.length ? { ts: nextIndex, id: `k${nextIndex}` } : null;
    return { items: slice, nextCursor };
  };
  return { fetch, calls };
}

describe('WindowedPageCache', () => {
  it('bounds the resident window and evicts the head when scrolling down', () => {
    const values = [0, 1, 2, 3, 4, 5]; // 3 pages of 2
    const { fetch } = arrayFetcher(values, 2);
    const cache = new WindowedPageCache<number>(2);

    cache.loadFirst(fetch);
    expect(cache.items()).toEqual([0, 1]);

    expect(cache.loadNext(fetch)).toBe(true);
    expect(cache.items()).toEqual([0, 1, 2, 3]);
    expect(cache.pageCount()).toBe(2);

    // Third page evicts the head; window holds only the last two pages.
    expect(cache.loadNext(fetch)).toBe(true);
    expect(cache.pageCount()).toBe(2);
    expect(cache.items()).toEqual([2, 3, 4, 5]);
    expect(cache.windowStart()).toBe(1);
    expect(cache.hasMore()).toBe(false);
  });

  it('re-fetches an evicted page by cursor when scrolling back up (anchor preserved)', () => {
    const values = [0, 1, 2, 3, 4, 5];
    const { fetch, calls } = arrayFetcher(values, 2);
    const cache = new WindowedPageCache<number>(2);

    cache.loadFirst(fetch);
    cache.loadNext(fetch);
    cache.loadNext(fetch); // head (page 0 -> [0,1]) evicted
    expect(cache.items()).toEqual([2, 3, 4, 5]);

    const callCountBefore = calls.length;
    expect(cache.loadPrevious(fetch)).toBe(true);
    // Re-fetched the evicted head page identically, evicting the tail.
    expect(cache.items()).toEqual([0, 1, 2, 3]);
    expect(cache.pageCount()).toBe(2);
    expect(cache.windowStart()).toBe(0);
    expect(calls.length).toBe(callCountBefore + 1); // exactly one re-fetch
    expect(calls[calls.length - 1]).toBeNull(); // page 0 uses the null cursor
  });

  it('stops at the top and bottom', () => {
    const { fetch } = arrayFetcher([0, 1], 2);
    const cache = new WindowedPageCache<number>(2);
    cache.loadFirst(fetch);
    expect(cache.loadNext(fetch)).toBe(false); // single page, no more
    expect(cache.loadPrevious(fetch)).toBe(false); // already at top
  });
});

describe('conversation history caches (bounded)', () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => db.close());

  it('keeps at most CONVERSATION_LIST_MAX_PAGES conversation-list pages', () => {
    let clock = 0;
    const repo = new ConversationRepository(db.driver, { now: () => (clock += 1) });
    for (let i = 0; i < 10; i += 1) {
      repo.createConversation({ id: `c${String(i).padStart(2, '0')}` });
    }

    const cache = createConversationListCache(repo, 2); // 2 per page → 5 pages
    expect(cache.pageCount()).toBe(1);
    loadMoreConversations(cache, repo, 2);
    loadMoreConversations(cache, repo, 2);
    loadMoreConversations(cache, repo, 2);
    loadMoreConversations(cache, repo, 2);

    expect(cache.pageCount()).toBe(CONVERSATION_LIST_MAX_PAGES);
    // Newest-first: the last window holds the two oldest pages.
    expect(cache.items().map((c) => c.id)).toEqual(['c03', 'c02', 'c01', 'c00']);
  });

  it('keeps at most MESSAGE_MAX_PAGES message pages per conversation', () => {
    const conversations = new ConversationRepository(db.driver, { now: () => 1 });
    conversations.createConversation({ id: 'c1' });
    const messages = new MessageRepository(db.driver);
    for (let i = 0; i < 12; i += 1) {
      messages.appendUserMessage({ id: `m${String(i).padStart(2, '0')}`, conversationId: 'c1', text: 'x', createdAt: i + 1 });
    }

    const cache = createMessageHistoryCache(messages, 'c1', 2); // 6 pages
    for (let i = 0; i < 5; i += 1) {
      loadOlderMessages(cache, messages, 'c1', 2);
    }
    expect(cache.pageCount()).toBe(MESSAGE_MAX_PAGES);
    expect(cache.items().length).toBe(MESSAGE_MAX_PAGES * 2);
  });
});
