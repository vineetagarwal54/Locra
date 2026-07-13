import { ConversationRepository } from '../../src/persistence/ConversationRepository';
import { createTestDatabase } from '../helpers/nodeSqliteDriver';

describe('conversation deletion cascade', () => {
  it('removes every derived row and unlinks every conversation image', () => {
    const db = createTestDatabase();
    const deletedPaths: string[] = [];
    try {
      const repository = new ConversationRepository(db.driver, {
        onUnlinkImageFiles: (paths) => deletedPaths.push(...paths),
      });
      repository.createConversation({ id: 'c1' });
      db.driver.runSync(
        `INSERT INTO message (id, conversation_id, role, is_active_attempt, text, status, created_at)
         VALUES ('u1', 'c1', 'user', 0, 'question', 'submitted', 1)`,
      );
      db.driver.runSync(
        `INSERT INTO message
         (id, conversation_id, role, reply_to_message_id, attempt_number, is_active_attempt,
          text, status, created_at)
         VALUES ('a1', 'c1', 'assistant', 'u1', 1, 1, 'answer', 'completed', 2)`,
      );
      db.driver.runSync(
        `INSERT INTO image_asset (id, conversation_id, local_path, available, created_at)
         VALUES ('i1', 'c1', '/images/one.jpg', 1, 1)`,
      );
      db.driver.runSync(
        `INSERT INTO message_image (message_id, image_asset_id, ordinal, created_at)
         VALUES ('u1', 'i1', 0, 1)`,
      );
      db.driver.runSync(
        `INSERT INTO visual_evidence
         (id, conversation_id, source_message_id, image_asset_id, evidence_version,
          subject_object, visible_features_json, visible_text_json, visible_condition,
          uncertainty_json, source_revision, created_at)
         VALUES ('e1','c1','u1','i1','v1','object','[]','[]','good','[]','r1',1)`,
      );
      db.driver.runSync(
        `INSERT INTO chunk
         (id, conversation_id, source_message_id, chunk_version, ordinal, start_offset,
          end_offset, text, source_revision, created_at)
         VALUES ('ch1','c1','u1','v1',0,0,8,'question','r1',1)`,
      );
      db.driver.runSync(
        `INSERT INTO durable_fact
         (id, conversation_id, normalized_key, value_text, fact_type, extraction_version,
          status, source_view_hash, created_at, updated_at)
         VALUES ('f1','c1','key','value','fact','v1','ready','h1',1,1)`,
      );
      db.driver.runSync("INSERT INTO durable_fact_source (fact_id,message_id) VALUES ('f1','u1')");
      db.driver.runSync(
        `INSERT INTO embedding
         (id, conversation_id, chunk_id, model_id, model_artifact_hash, embedding_version,
          dimensions, source_revision, vector, state, created_at, updated_at)
         VALUES ('em1','c1','ch1','model','hash','v1',1,'r1',?,'ready',1,1)`,
        [new Uint8Array([0, 0, 128, 63])],
      );
      db.driver.runSync(
        `INSERT INTO summary
         (id, conversation_id, first_source_message_id, last_source_message_id,
          source_view_hash, summarizer_version, text, status, version, created_at, updated_at)
         VALUES ('s1','c1','u1','a1','h1','v1','summary','ready',1,1,1)`,
      );

      repository.deleteConversation('c1');

      for (const table of [
        'message', 'message_image', 'image_asset', 'visual_evidence', 'chunk', 'embedding',
        'summary', 'durable_fact', 'durable_fact_source',
      ]) {
        expect(db.driver.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n)
          .toBe(0);
      }
      expect(deletedPaths).toEqual(['/images/one.jpg']);
    } finally {
      db.close();
    }
  });
});
