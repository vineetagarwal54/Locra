const mockProductionStorage = {
  set: jest.fn(),
  getString: jest.fn(),
  getAllKeys: jest.fn((): string[] => []),
  remove: jest.fn(() => false),
};

jest.mock('../../src/storage/mmkv', () => ({
  storage: mockProductionStorage,
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { HistoryStore, type HistoryStorage } from '../../src/history/HistoryStore';
import type { MetricsSummary, PerformanceMetrics, QASession } from '../../src/types/models';

class MemoryHistoryStorage implements HistoryStorage {
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

const metrics: PerformanceMetrics = {
  modelLoadTimeMs: 10,
  preprocessingTimeMs: 20,
  firstTokenLatencyMs: 30,
  tokensPerSecond: 5,
  totalWallTimeMs: 40,
};

function makeSession(overrides: Partial<QASession> = {}): QASession {
  return {
    id: 'session',
    createdAt: 100,
    imagePath: '/photo.jpg',
    question: 'What is this?',
    answer: 'A mug.',
    turns: [{ question: 'What is this?', answer: 'A mug.' }],
    pinnedExtraction: 'Subject/object: mug',
    status: 'completed',
    errorMessage: null,
    metrics,
    flagged: false,
    flagNote: null,
    ...overrides,
  };
}

function makeStore(): HistoryStore {
  return new HistoryStore(new MemoryHistoryStorage());
}

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('History store contract', () => {
  it('saves terminal sessions, returns newest first, and supports get()', () => {
    const store = makeStore();
    const oldest = makeSession({ id: 'oldest', createdAt: 1 });
    const newest = makeSession({ id: 'newest', createdAt: 3 });
    const middle = makeSession({ id: 'middle', createdAt: 2 });

    store.save(oldest);
    store.save(newest);
    store.save(middle);

    expect(store.get('newest')).toEqual(newest);
    expect(store.list().map((session) => session.id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('delete and clear remove entries so they do not reappear through the app', () => {
    const store = makeStore();
    store.save(makeSession({ id: 'one' }));
    store.save(makeSession({ id: 'two' }));

    store.delete('one');
    expect(store.get('one')).toBeNull();
    expect(store.list().map((session) => session.id)).toEqual(['two']);

    store.clear();
    expect(store.list()).toEqual([]);
  });

  it('setFlag updates existing sessions and no-ops for missing ids', () => {
    const store = makeStore();
    const session = makeSession({ id: 'flag-me' });
    store.save(session);

    expect(() => store.setFlag('missing', true, 'bad answer')).not.toThrow();
    store.setFlag(session.id, true, 'bad answer');

    expect(store.get(session.id)).toEqual({
      ...session,
      flagged: true,
      flagNote: 'bad answer',
    });
  });

  it('summarizes metrics only from sessions with completed metrics', () => {
    const store = makeStore();
    store.save(makeSession({ id: 'one', metrics }));
    store.save(
      makeSession({
        id: 'two',
        metrics: {
          modelLoadTimeMs: 30,
          preprocessingTimeMs: 40,
          firstTokenLatencyMs: 50,
          tokensPerSecond: 7,
          totalWallTimeMs: 60,
        },
      })
    );
    store.save(makeSession({ id: 'errored', status: 'errored', metrics: null }));

    const summary: MetricsSummary = store.getMetricsSummary();

    expect(summary).toEqual({
      count: 2,
      averageModelLoadTimeMs: 20,
      averagePreprocessingTimeMs: 30,
      averageFirstTokenLatencyMs: 40,
      averageTokensPerSecond: 6,
      averageTotalWallTimeMs: 50,
    });
  });

  it('keeps history persistence structurally MMKV-only and boundary-local', () => {
    const source = readSource('src/history/HistoryStore.ts');

    expect(source).not.toMatch(/AsyncStorage|SQLite|sqlite|expo-sqlite|react-native-sqlite/i);
    expect(source).not.toMatch(/['"]\.\.\/(screens|inference|model)\//);
  });
});
