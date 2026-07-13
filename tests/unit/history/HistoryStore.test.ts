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
import type {
  Conversation,
  ConversationContextMemory,
  PerformanceMetrics,
} from '../../../src/types/models';

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

function makeContextMemory(): ConversationContextMemory {
  return {
    version: 'conversation-context-memory-v1',
    sourceMessageCount: 2,
    rollingSummary: {
      version: 'rolling-summary-v1',
      coveredThroughMessageId: 'conversation-1:assistant',
      sourceMessageIds: ['conversation-1:user', 'conversation-1:assistant'],
      entries: [
        {
          version: 'context-summary-entry-v1',
          sourceUserMessageId: 'conversation-1:user',
          sourceAssistantMessageId: 'conversation-1:assistant',
          text: 'User: What is this?\nLocra: A small object.',
          createdAt: 1_700_000_000_001,
        },
      ],
    },
    importantFacts: [
      {
        version: 'context-memory-fact-v1',
        id: 'conversation-1:assistant:fact:0',
        sourceMessageId: 'conversation-1:assistant',
        text: 'A small object.',
        createdAt: 1_700_000_000_001,
      },
    ],
    mediaEvidence: [
      {
        version: 'context-media-evidence-v1',
        id: 'conversation-1:user:image',
        sourceMessageId: 'conversation-1:user',
        modality: 'image',
        sourcePath: '/tmp/photo.jpg',
        summary: 'small object',
        facts: ['round'],
        extractedText: [],
        uncertainty: [],
        createdAt: 1_700_000_000_000,
      },
    ],
  };
}

describe('HistoryStore', () => {
  it('save persists a terminal-state conversation and get returns it', () => {
    const store = makeStore();
    const conversation = makeConversation();

    store.save(conversation);

    expect(store.get(conversation.id)).toEqual(conversation);
  });

  it('round-trips versioned derived context memory without changing raw messages', () => {
    const store = makeStore();
    const conversation = makeConversation({ contextMemory: makeContextMemory() });

    store.save(conversation);

    expect(store.get(conversation.id)?.contextMemory).toEqual(makeContextMemory());
    expect(store.get(conversation.id)?.messages).toEqual(conversation.messages);
  });

  it('keeps conversations without derived memory backward compatible', () => {
    const store = makeStore();
    const conversation = makeConversation();

    store.save(conversation);

    expect(store.get(conversation.id)).toEqual(conversation);
    expect(store.get(conversation.id)?.contextMemory).toBeUndefined();
  });

  it('drops unknown derived-memory versions so they can be regenerated', () => {
    const storage = new TestHistoryStorage();
    const store = new HistoryStore(storage);
    const conversation = makeConversation();
    storage.set(
      'history:session:conversation-1',
      JSON.stringify({
        ...conversation,
        contextMemory: { version: 'conversation-context-memory-v99', unsafe: true },
      }),
    );

    expect(store.get(conversation.id)?.contextMemory).toBeUndefined();
    expect(store.get(conversation.id)?.messages).toEqual(conversation.messages);
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
