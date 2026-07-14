import { FactRepository } from '../../../src/persistence/FactRepository';
import { createTestDatabase, type TestDatabase } from '../../helpers/nodeSqliteDriver';

describe('FactRepository', () => {
  let db: TestDatabase;
  beforeEach(() => {
    db = createTestDatabase();
    db.driver.runSync(
      `INSERT INTO conversation (id, response_mode, created_at, updated_at)
       VALUES ('c1', 'medium', 1, 1)`,
    );
    db.driver.runSync(
      `INSERT INTO message (id, conversation_id, role, is_active_attempt, text, status, created_at)
       VALUES ('m1', 'c1', 'user', 0, 'one', 'submitted', 1),
              ('m2', 'c1', 'user', 0, 'two', 'submitted', 2)`,
    );
  });
  afterEach(() => db.close());

  it('deduplicates normalized keys and merges source links for equal values', () => {
    const repository = new FactRepository(db.driver, { createId: () => 'f1', now: () => 10 });
    repository.upsert({
      conversationId: 'c1', normalizedKey: ' Trip-Date ', valueText: 'Sep 3', factType: 'fact',
      extractionVersion: 'v1', sourceViewHash: 'h1', sourceMessageIds: ['m1'],
    });
    repository.upsert({
      conversationId: 'c1', normalizedKey: 'trip date', valueText: 'Sep 3', factType: 'fact',
      extractionVersion: 'v1', sourceViewHash: 'h2', sourceMessageIds: ['m2'],
    });

    expect(repository.getReadyFacts('c1')).toHaveLength(1);
    expect(repository.getSourceMessageIds('f1')).toEqual(['m1', 'm2']);
  });

  it('retains and supersedes a contradictory older fact', () => {
    let id = 0;
    const repository = new FactRepository(db.driver, { createId: () => `f${++id}`, now: () => id });
    const older = repository.upsert({
      conversationId: 'c1', normalizedKey: 'trip date', valueText: 'Sep 3', factType: 'fact',
      extractionVersion: 'v1', sourceViewHash: 'h1', sourceMessageIds: ['m1'],
    });
    const newer = repository.upsert({
      conversationId: 'c1', normalizedKey: 'trip date', valueText: 'Sep 4', factType: 'fact',
      extractionVersion: 'v1', sourceViewHash: 'h2', sourceMessageIds: ['m2'],
    });

    expect(newer.supersedes_fact_id).toBe(older.id);
    expect(repository.getReadyFacts('c1')).toEqual([expect.objectContaining({ value_text: 'Sep 4' })]);
    expect(db.driver.getFirstSync<{ status: string }>(
      'SELECT status FROM durable_fact WHERE id = ?', [older.id],
    )?.status).toBe('superseded');
  });
});

