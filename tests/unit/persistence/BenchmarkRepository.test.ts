import { BenchmarkRepository } from '../../../src/persistence/BenchmarkRepository';
import { ConversationRepository } from '../../../src/persistence/ConversationRepository';
import type { PerformanceMetrics } from '../../../src/types/models';
import { createTestDatabase } from '../../helpers/nodeSqliteDriver';

const METRICS: PerformanceMetrics = {
  modelLoadTimeMs: 900,
  preprocessingTimeMs: 40,
  firstTokenLatencyMs: 300,
  tokensPerSecond: 12.5,
  totalWallTimeMs: 4200,
};

function setup() {
  const db = createTestDatabase();
  const conversations = new ConversationRepository(db.driver);
  conversations.createConversation({ id: 'c1' });
  let sequence = 0;
  const repository = new BenchmarkRepository(db.driver, {
    now: () => 1000 + sequence,
    createId: () => `bench-${(sequence += 1)}`,
  });
  return { db, repository };
}

describe('BenchmarkRepository', () => {
  it('records a completed run and lists it newest-first', () => {
    const { db, repository } = setup();
    try {
      const first = repository.record({ conversationId: 'c1', messageId: null, kind: 'text', metrics: METRICS });
      const second = repository.record({ conversationId: 'c1', messageId: null, kind: 'image', metrics: METRICS });

      const recent = repository.listRecent();
      expect(recent).toHaveLength(2);
      expect(recent[0].id).toBe(second.id);
      expect(recent[0].tokens_per_second).toBeCloseTo(12.5);
      expect(recent[1].id).toBe(first.id);
    } finally {
      db.close();
    }
  });

  it('filters by kind and counts only matching runs', () => {
    const { db, repository } = setup();
    try {
      repository.record({ conversationId: 'c1', messageId: null, kind: 'text', metrics: METRICS });
      const image1 = repository.record({ conversationId: 'c1', messageId: null, kind: 'image', metrics: METRICS });
      const image2 = repository.record({ conversationId: 'c1', messageId: null, kind: 'image', metrics: METRICS });

      expect(repository.count('all')).toBe(3);
      expect(repository.count('text')).toBe(1);
      expect(repository.count('image')).toBe(2);
      expect(repository.listRecent('image').map((run) => run.id)).toEqual([image2.id, image1.id]);
    } finally {
      db.close();
    }
  });

  it('starts empty so the screen can show its empty state', () => {
    const { db, repository } = setup();
    try {
      expect(repository.count('all')).toBe(0);
      expect(repository.listRecent()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
