const mockProductionStorage = {
  set: jest.fn(),
  getString: jest.fn(),
  getAllKeys: jest.fn((): string[] => []),
  remove: jest.fn(() => false),
};

jest.mock('../../../src/storage/mmkv', () => ({
  storage: mockProductionStorage,
}));

import { HistoryStore, type HistoryStorage } from '../../../src/history/HistoryStore';
import type { PerformanceMetrics, QASession } from '../../../src/types/models';

class TestHistoryStorage implements HistoryStorage {
  private readonly values = new Map<string, string | number | boolean | ArrayBuffer>();

  set(key: string, value: string | number | boolean | ArrayBuffer): void {
    this.values.set(key, value);
  }

  getString(key: string): string | undefined {
    const value = this.values.get(key);
    return typeof value === 'string' ? value : undefined;
  }

  getAllKeys(): string[] {
    return Array.from(this.values.keys());
  }

  remove(key: string): boolean {
    return this.values.delete(key);
  }
}

const METRICS: PerformanceMetrics = {
  modelLoadTimeMs: 10,
  preprocessingTimeMs: 20,
  firstTokenLatencyMs: 30,
  tokensPerSecond: 4.5,
  totalWallTimeMs: 40,
};

function makeSession(overrides: Partial<QASession> = {}): QASession {
  return {
    id: 'session-1',
    createdAt: 1_700_000_000_000,
    imagePath: '/tmp/photo.jpg',
    question: 'What is this?',
    answer: 'A small object.',
    status: 'completed',
    errorMessage: null,
    metrics: METRICS,
    flagged: false,
    flagNote: null,
    ...overrides,
  };
}

function makeStore(): HistoryStore {
  return new HistoryStore(new TestHistoryStorage());
}

describe('HistoryStore', () => {
  it('save persists a terminal-state session and get returns it', () => {
    const store = makeStore();
    const session = makeSession();

    store.save(session);

    expect(store.get(session.id)).toEqual(session);
  });

  it('list returns sessions newest-first', () => {
    const store = makeStore();
    const oldest = makeSession({ id: 'oldest', createdAt: 100 });
    const newest = makeSession({ id: 'newest', createdAt: 300 });
    const middle = makeSession({ id: 'middle', createdAt: 200 });

    store.save(oldest);
    store.save(newest);
    store.save(middle);

    expect(store.list().map((session) => session.id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('delete removes an entry such that a later get returns null', () => {
    const store = makeStore();
    const session = makeSession();
    store.save(session);

    store.delete(session.id);

    expect(store.get(session.id)).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it('clear empties the list', () => {
    const store = makeStore();
    store.save(makeSession({ id: 'one' }));
    store.save(makeSession({ id: 'two' }));

    store.clear();

    expect(store.list()).toEqual([]);
  });

  it('setFlag on a nonexistent id no-ops rather than throwing', () => {
    const store = makeStore();

    expect(() => store.setFlag('missing', true, 'wrong')).not.toThrow();
    expect(store.list()).toEqual([]);
  });

  it('setFlag updates an existing session locally', () => {
    const store = makeStore();
    const session = makeSession();
    store.save(session);

    store.setFlag(session.id, true, 'not helpful');

    expect(store.get(session.id)).toEqual({
      ...session,
      flagged: true,
      flagNote: 'not helpful',
    });
  });
});
