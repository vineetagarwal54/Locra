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
import type { Conversation, MetricsSummary, PerformanceMetrics } from '../../src/types/models';

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

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const id = overrides.id ?? 'conversation';
  const createdAt = overrides.createdAt ?? 100;
  return {
    id,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    messages: [
      {
        id: `${id}:user`,
        role: 'user',
        text: 'What is this?',
        attachments: [{ kind: 'image', path: '/photo.jpg' }],
        status: 'completed',
        errorMessage: null,
        createdAt,
      },
      {
        id: `${id}:assistant`,
        role: 'assistant',
        text: 'A mug.',
        attachments: [],
        status: 'completed',
        errorMessage: null,
        createdAt: createdAt + 1,
      },
    ],
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
  it('saves terminal conversations, returns newest first by updatedAt, and supports get()', () => {
    const store = makeStore();
    const oldest = makeConversation({ id: 'oldest', createdAt: 1, updatedAt: 10 });
    const newest = makeConversation({ id: 'newest', createdAt: 3, updatedAt: 30 });
    const middle = makeConversation({ id: 'middle', createdAt: 2, updatedAt: 20 });

    store.save(oldest);
    store.save(newest);
    store.save(middle);

    expect(store.get('newest')).toEqual(newest);
    expect(store.list().map((conversation) => conversation.id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
    expect(store.get('newest')?.messages[0]).toEqual(
      expect.objectContaining({
        id: 'newest:user',
        role: 'user',
        attachments: [{ kind: 'image', path: '/photo.jpg' }],
      })
    );
  });

  it('delete and clear remove entries so they do not reappear through the app', () => {
    const store = makeStore();
    store.save(makeConversation({ id: 'one' }));
    store.save(makeConversation({ id: 'two' }));

    store.delete('one');
    expect(store.get('one')).toBeNull();
    expect(store.list().map((conversation) => conversation.id)).toEqual(['two']);

    store.clear();
    expect(store.list()).toEqual([]);
  });

  it('setFlag updates existing sessions and no-ops for missing ids', () => {
    const store = makeStore();
    const conversation = makeConversation({ id: 'flag-me' });
    store.save(conversation);

    expect(() => store.setFlag('missing', true, 'bad answer')).not.toThrow();
    store.setFlag(conversation.id, true, 'bad answer');

    expect(store.get(conversation.id)).toEqual({
      ...conversation,
      flagged: true,
      flagNote: 'bad answer',
    });
  });

  it('summarizes metrics only from sessions with completed metrics', () => {
    const store = makeStore();
    store.save(makeConversation({ id: 'one', metrics }));
    store.save(
      makeConversation({
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
    store.save(makeConversation({ id: 'errored', status: 'errored', metrics: null }));

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

  it('list(limit, offset) slices across more than one page and still reaches older conversations', () => {
    const store = makeStore();
    const oneDay = 24 * 60 * 60 * 1000;
    const now = 1_700_000_000_000;

    for (let index = 0; index < 12; index += 1) {
      store.save(
        makeConversation({
          id: `conversation-${index}`,
          createdAt: now - index * oneDay,
          updatedAt: now - index * oneDay,
        })
      );
    }

    expect(store.list(5, 0).map((conversation) => conversation.id)).toEqual([
      'conversation-0',
      'conversation-1',
      'conversation-2',
      'conversation-3',
      'conversation-4',
    ]);
    expect(store.list(5, 5).map((conversation) => conversation.id)).toEqual([
      'conversation-5',
      'conversation-6',
      'conversation-7',
      'conversation-8',
      'conversation-9',
    ]);
    expect(store.list(undefined, 10).map((conversation) => conversation.id)).toEqual([
      'conversation-10',
      'conversation-11',
    ]);
  });

  it('keeps history persistence structurally MMKV-only and boundary-local', () => {
    const source = readSource('src/history/HistoryStore.ts');

    expect(source).not.toMatch(/AsyncStorage|SQLite|sqlite|expo-sqlite|react-native-sqlite/i);
    expect(source).not.toMatch(/['"]\.\.\/(screens|inference|model)\//);
  });
});
