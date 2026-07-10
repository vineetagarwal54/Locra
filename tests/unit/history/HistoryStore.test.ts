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
import type { Conversation, PerformanceMetrics } from '../../../src/types/models';

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

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const id = overrides.id ?? 'conversation-1';
  const createdAt = overrides.createdAt ?? 1_700_000_000_000;
  return {
    id,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    messages: [
      {
        id: `${id}:user`,
        role: 'user',
        text: 'What is this?',
        attachments: [{ kind: 'image', path: '/tmp/photo.jpg' }],
        status: 'completed',
        errorMessage: null,
        createdAt,
      },
      {
        id: `${id}:assistant`,
        role: 'assistant',
        text: 'A small object.',
        attachments: [],
        status: 'completed',
        errorMessage: null,
        createdAt: createdAt + 1,
      },
    ],
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
  it('save persists a terminal-state conversation and get returns it', () => {
    const store = makeStore();
    const conversation = makeConversation();

    store.save(conversation);

    expect(store.get(conversation.id)).toEqual(conversation);
  });

  it('list returns conversations newest-first by updatedAt', () => {
    const store = makeStore();
    const oldest = makeConversation({ id: 'oldest', createdAt: 100, updatedAt: 30 });
    const newest = makeConversation({ id: 'newest', createdAt: 300, updatedAt: 50 });
    const middle = makeConversation({ id: 'middle', createdAt: 200, updatedAt: 40 });

    store.save(oldest);
    store.save(newest);
    store.save(middle);

    expect(store.list().map((conversation) => conversation.id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  it('delete removes an entry such that a later get returns null', () => {
    const store = makeStore();
    const conversation = makeConversation();
    store.save(conversation);

    store.delete(conversation.id);

    expect(store.get(conversation.id)).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it('clear empties the list', () => {
    const store = makeStore();
    store.save(makeConversation({ id: 'one' }));
    store.save(makeConversation({ id: 'two' }));

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
    const conversation = makeConversation();
    store.save(conversation);

    store.setFlag(conversation.id, true, 'not helpful');

    expect(store.get(conversation.id)).toEqual({
      ...conversation,
      flagged: true,
      flagNote: 'not helpful',
    });
  });
});
