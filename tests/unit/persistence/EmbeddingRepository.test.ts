import { EmbeddingRepository } from '../../../src/persistence/EmbeddingRepository';
import type { EmbeddingUpsertInput } from '../../../src/persistence/EmbeddingRepository';
import { createTestDatabase, type TestDatabase } from '../../helpers/nodeSqliteDriver';

function seedSources(db: TestDatabase): void {
  db.driver.runSync(
    `INSERT INTO conversation (id, title, normalized_title, response_mode, created_at, updated_at)
     VALUES ('conversation-1', NULL, NULL, 'medium', 1, 1),
            ('conversation-2', NULL, NULL, 'medium', 1, 1)`,
  );
  db.driver.runSync(
    `INSERT INTO message (id, conversation_id, role, is_active_attempt, text, status, created_at)
     VALUES ('message-1', 'conversation-1', 'user', 0, 'active text', 'submitted', 2),
            ('message-2', 'conversation-2', 'user', 0, 'foreign text', 'submitted', 3)`,
  );
  db.driver.runSync(
    `INSERT INTO chunk (id, conversation_id, source_message_id, image_asset_id, chunk_version,
       ordinal, start_offset, end_offset, text, source_revision, created_at)
     VALUES ('chunk-1', 'conversation-1', 'message-1', NULL, 'chunk-v1', 0, 0, 11,
       'active text', 'source-r1', 2),
            ('chunk-2', 'conversation-2', 'message-2', NULL, 'chunk-v1', 0, 0, 12,
       'foreign text', 'source-r1', 3)`,
  );
}

function embedding(id: string, conversationId: string, chunkId: string): EmbeddingUpsertInput {
  return {
    id, conversationId, source: { kind: 'chunk', id: chunkId }, modelId: 'model-1',
    modelArtifactHash: 'hash-1', embeddingVersion: 'embedding-v1', dimensions: 2,
    sourceRevision: 'source-r1', vector: new Float32Array([1, 0]), state: 'ready', createdAt: 10,
  };
}

describe('EmbeddingRepository', () => {
  let db: TestDatabase;
  beforeEach(() => { db = createTestDatabase(); seedSources(db); });
  afterEach(() => db.close());

  it('returns only ready compatible vectors inside the requested scope', () => {
    const repository = new EmbeddingRepository(db.driver);
    repository.upsert(embedding('embedding-1', 'conversation-1', 'chunk-1'));
    repository.upsert(embedding('embedding-2', 'conversation-2', 'chunk-2'));

    const result = repository.getCompatibleByScope(['conversation-1'], 'embedding-v1', 'hash-1');

    expect(result).toEqual([expect.objectContaining({
      sourceConversationId: 'conversation-1', sourceMessageId: 'message-1',
      text: 'active text', vector: new Float32Array([1, 0]),
    })]);
  });

  it('marks mismatched source revisions stale and caps pending batches at 25', () => {
    const repository = new EmbeddingRepository(db.driver);
    repository.upsert(embedding('embedding-ready', 'conversation-1', 'chunk-1'));
    repository.markStaleByRevision({ kind: 'chunk', id: 'chunk-1' }, 'source-r2');
    expect(repository.getById('embedding-ready')?.state).toBe('stale');

    for (let index = 0; index < 30; index += 1) {
      repository.upsert({
        ...embedding(`pending-${index}`, 'conversation-1', 'chunk-1'),
        modelArtifactHash: `pending-hash-${index}`,
        state: 'pending',
        createdAt: index,
      });
    }
    expect(repository.pendingBatch(100)).toHaveLength(25);
  });
});
