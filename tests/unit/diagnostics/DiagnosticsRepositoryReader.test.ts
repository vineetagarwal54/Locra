import { DiagnosticsRepositoryReader } from '../../../src/diagnostics/DiagnosticsRepositoryReader';
import type { ConversationRow, MessageRow } from '../../../src/types/models';

function conversationRow(): ConversationRow {
  return {
    id: 'conversation-a',
    title: 'Test chat',
    normalized_title: 'test chat',
    response_mode: 'medium',
    created_at: 10,
    updated_at: 40,
    deleted_at: null,
    latest_message_preview: 'done',
    has_image: 1,
  };
}

function messageRow(id: string, createdAt: number, role: 'user' | 'assistant'): MessageRow {
  return {
    id,
    conversation_id: 'conversation-a',
    role,
    reply_to_message_id: role === 'assistant' ? 'user-1' : null,
    attempt_number: role === 'assistant' ? Number(id.at(-1)) : null,
    is_active_attempt: id === 'assistant-2' ? 1 : 0,
    text: id,
    status: role === 'user' ? 'submitted' : 'completed',
    error_message: null,
    finalized_at: role === 'assistant' ? createdAt : null,
    created_at: createdAt,
  };
}

describe('DiagnosticsRepositoryReader', () => {
  it('pages repositories until every user message and assistant attempt is included', () => {
    const firstPage = [messageRow('assistant-2', 30, 'assistant'), messageRow('assistant-1', 20, 'assistant')];
    const secondPage = [messageRow('user-1', 10, 'user')];
    const listMessages = jest
      .fn()
      .mockReturnValueOnce({ items: firstPage, nextCursor: { ts: 20, id: 'assistant-1' } })
      .mockReturnValueOnce({ items: secondPage, nextCursor: null });
    const reader = new DiagnosticsRepositoryReader(
      { getConversation: jest.fn(() => conversationRow()) },
      { listMessages },
    );

    const result = reader.read(['conversation-a']);

    expect(listMessages).toHaveBeenNthCalledWith(1, {
      conversationId: 'conversation-a',
      limit: 50,
    });
    expect(listMessages).toHaveBeenNthCalledWith(2, {
      conversationId: 'conversation-a',
      before: { ts: 20, id: 'assistant-1' },
      limit: 50,
    });
    expect(result[0]?.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'assistant-2',
    ]);
  });
});
