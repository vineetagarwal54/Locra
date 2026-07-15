import { fromStoredMode } from '../inference/ResponseMode';
import type { ConversationRepository } from '../persistence/ConversationRepository';
import type { MessageRepository } from '../persistence/MessageRepository';
import type { Keyset } from '../persistence/types';
import type { Conversation, ConversationMessage, MessageRow } from '../types/models';

type DiagnosticConversations = Pick<ConversationRepository, 'getConversation'>;
type DiagnosticMessages = Pick<MessageRepository, 'listMessages'>;

/** Reads complete selected transcripts from SQL pages, never from bounded UI caches. */
export class DiagnosticsRepositoryReader {
  constructor(
    private readonly conversations: DiagnosticConversations,
    private readonly messages: DiagnosticMessages,
  ) {}

  read(conversationIds: ReadonlyArray<string>): Conversation[] {
    return conversationIds.flatMap((conversationId) => {
      const conversation = this.conversations.getConversation(conversationId);
      if (conversation === null) {
        return [];
      }
      const rows = this.readAllMessages(conversationId);
      const messages = rows.map(toDiagnosticMessage);
      const latest = messages.at(-1);
      return [{
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
        messages,
        status: latest?.status === 'generating'
          ? 'streaming'
          : latest?.status === 'failed'
            ? 'errored'
            : latest?.status === 'interrupted'
              ? 'cancelled'
              : messages.length === 0
                ? 'idle'
                : 'completed',
        errorMessage: latest?.errorMessage ?? null,
        metrics: null,
        flagged: false,
        flagNote: null,
        contextMemory: null,
        responseMode: fromStoredMode(conversation.response_mode),
        latestMessagePreview: conversation.latest_message_preview,
        hasImage: conversation.has_image === 1,
      }];
    });
  }

  private readAllMessages(conversationId: string): MessageRow[] {
    const rows: MessageRow[] = [];
    let page = this.messages.listMessages({ conversationId, limit: 50 });
    rows.push(...page.items);
    while (page.nextCursor !== null) {
      const before: Keyset = page.nextCursor;
      page = this.messages.listMessages({ conversationId, before, limit: 50 });
      rows.push(...page.items);
    }
    return rows.sort((left, right) =>
      left.created_at - right.created_at || left.id.localeCompare(right.id));
  }
}

function toDiagnosticMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    attachments: [],
    status: row.role === 'user'
      ? 'completed'
      : row.status === 'submitted'
        ? 'completed'
        : row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}
