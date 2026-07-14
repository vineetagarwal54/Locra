import { ChunkRepository } from '../../../src/persistence/ChunkRepository';
import type { MessageChunk } from '../../../src/retrieval/ChunkingService';
import { createTestDatabase, type TestDatabase } from '../../helpers/nodeSqliteDriver';

function seedConversationAndMessage(db: TestDatabase): void {
  db.driver.runSync(
    `INSERT INTO conversation (id, title, normalized_title, response_mode, created_at, updated_at)
     VALUES ('conversation-1', NULL, NULL, 'medium', 1, 1)`,
  );
  db.driver.runSync(
    `INSERT INTO message (id, conversation_id, role, is_active_attempt, text, status, created_at)
     VALUES ('message-1', 'conversation-1', 'user', 0, 'original', 'submitted', 2)`,
  );
}

function chunk(ordinal: number, text: string, revision = 'revision-1'): MessageChunk {
  return {
    id: `message-1:chunk-v1:${ordinal}`,
    conversationId: 'conversation-1', sourceMessageId: 'message-1', imageAssetId: null,
    chunkVersion: 'chunk-v1', ordinal, startOffset: ordinal * 10,
    endOffset: ordinal * 10 + text.length, text, sourceRevision: revision, createdAt: 2,
  };
}

describe('ChunkRepository', () => {
  let db: TestDatabase;
  beforeEach(() => { db = createTestDatabase(); seedConversationAndMessage(db); });
  afterEach(() => db.close());

  it('atomically replaces one message/version while preserving source references', () => {
    const repository = new ChunkRepository(db.driver);
    repository.upsertChunksForMessage('message-1', 'chunk-v1', [chunk(0, 'first'), chunk(1, 'second')]);
    repository.upsertChunksForMessage('message-1', 'chunk-v1', [chunk(0, 'replacement', 'revision-2')]);

    expect(repository.listForMessage('message-1', 'chunk-v1')).toEqual([
      expect.objectContaining({
        source_message_id: 'message-1', conversation_id: 'conversation-1', ordinal: 0,
        text: 'replacement', source_revision: 'revision-2',
      }),
    ]);
  });
});

