// Bounded caches for the history UI (research R12 / FR-005). Wires the generic
// WindowedPageCache to the SQL repositories with the configured page caps so the
// UI keeps only a small window of conversation-list and message pages in memory
// instead of the whole database. This is the read-path mechanism the live
// conversation store consumes; the store/screen wiring is a separate step (US1
// T020–T022) validated on-device.

import type { ConversationRepository } from '../persistence/ConversationRepository';
import type { MessageRepository } from '../persistence/MessageRepository';
import { MAX_PAGE_SIZE } from '../persistence/types';
import { WindowedPageCache } from '../persistence/WindowedPageCache';
import type { ConversationRow, MessageRow } from '../types/models';

/** At most two conversation-list pages are kept resident. */
export const CONVERSATION_LIST_MAX_PAGES = 2;
/** At most three message pages per active conversation are kept resident. */
export const MESSAGE_MAX_PAGES = 3;
/** Default records fetched per page (bounded by MAX_PAGE_SIZE). */
export const DEFAULT_PAGE_SIZE = MAX_PAGE_SIZE;

export function createConversationListCache(
  repository: ConversationRepository,
  pageSize: number = DEFAULT_PAGE_SIZE,
): WindowedPageCache<ConversationRow> {
  const cache = new WindowedPageCache<ConversationRow>(CONVERSATION_LIST_MAX_PAGES);
  cache.loadFirst((before) => repository.listConversations({ before: before ?? undefined, limit: pageSize }));
  return cache;
}

export function loadMoreConversations(
  cache: WindowedPageCache<ConversationRow>,
  repository: ConversationRepository,
  pageSize: number = DEFAULT_PAGE_SIZE,
): boolean {
  return cache.loadNext((before) =>
    repository.listConversations({ before: before ?? undefined, limit: pageSize }),
  );
}

export function createMessageHistoryCache(
  repository: MessageRepository,
  conversationId: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): WindowedPageCache<MessageRow> {
  const cache = new WindowedPageCache<MessageRow>(MESSAGE_MAX_PAGES);
  cache.loadFirst((before) =>
    repository.listMessages({ conversationId, before: before ?? undefined, limit: pageSize }),
  );
  return cache;
}

export function loadOlderMessages(
  cache: WindowedPageCache<MessageRow>,
  repository: MessageRepository,
  conversationId: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): boolean {
  return cache.loadNext((before) =>
    repository.listMessages({ conversationId, before: before ?? undefined, limit: pageSize }),
  );
}
