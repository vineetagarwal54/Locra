// T023 — deterministic seed fixture for scale validation (SC-001/002/003). Fills
// the SQL store with many conversations, a few of them very long, so pagination,
// bounded caching, and delete-cascade can be exercised on-device and in tests.

import type { ConversationRepository } from '../../persistence/ConversationRepository';
import type { MessageRepository } from '../../persistence/MessageRepository';

export interface SeedOptions {
  /** Total conversations to create (default 200 — the FR-002 floor). */
  conversationCount?: number;
  /** How many of them get a long message history (default 3). */
  longConversationCount?: number;
  /** Messages per long conversation (default 500). */
  longConversationMessages?: number;
  /** Messages per normal conversation (default 4). */
  normalConversationMessages?: number;
}

export interface SeedResult {
  conversationIds: string[];
  longConversationIds: string[];
  totalMessages: number;
}

/**
 * Seeds conversations with monotonically increasing timestamps so keyset order
 * is deterministic. Returns the created ids for assertions.
 */
export function seedConversations(
  conversations: ConversationRepository,
  messages: MessageRepository,
  options: SeedOptions = {},
): SeedResult {
  const conversationCount = options.conversationCount ?? 200;
  const longConversationCount = options.longConversationCount ?? 3;
  const longMessages = options.longConversationMessages ?? 500;
  const normalMessages = options.normalConversationMessages ?? 4;

  const conversationIds: string[] = [];
  const longConversationIds: string[] = [];
  let totalMessages = 0;
  let clock = 1;

  for (let index = 0; index < conversationCount; index += 1) {
    const id = `seed-conversation-${String(index).padStart(4, '0')}`;
    // Timestamp increases per conversation so newer indices sort first.
    conversations.createConversation({ id, title: `Seed conversation ${index}` });

    const isLong = index < longConversationCount;
    if (isLong) {
      longConversationIds.push(id);
    }
    const messageCount = isLong ? longMessages : normalMessages;
    for (let m = 0; m < messageCount; m += 1) {
      messages.appendUserMessage({
        id: `${id}-msg-${String(m).padStart(4, '0')}`,
        conversationId: id,
        text: `Message ${m} in conversation ${index}`,
        createdAt: clock,
      });
      clock += 1;
      totalMessages += 1;
    }
    conversationIds.push(id);
  }

  return { conversationIds, longConversationIds, totalMessages };
}
