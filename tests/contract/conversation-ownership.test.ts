jest.mock('../../src/storage/mmkv', () => ({
  storage: {
    set: jest.fn(),
    getString: jest.fn(),
    getAllKeys: jest.fn((): string[] => []),
    remove: jest.fn(() => false),
  },
}));
jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));
jest.mock('../../src/store/historyStore', () => ({
  historyStore: {
    save: jest.fn(),
    get: jest.fn(() => null),
    list: jest.fn(() => []),
    delete: jest.fn(),
    clear: jest.fn(),
    setFlag: jest.fn(),
    getMetricsSummary: jest.fn(),
  },
}));

import { createConversationStore } from '../../src/store/conversationStore';
import type { IHistoryStore, IInferenceQueue } from '../../src/types/interfaces';
import type { Conversation, InferenceState, MetricsSummary } from '../../src/types/models';

class ContractQueue implements IInferenceQueue {
  readonly submitted: Array<{
    requestId?: string;
    conversationId?: string;
    originatingUserMessageId?: string;
    assistantMessageId?: string;
    imagePath: string | null;
    question: string;
  }> = [];

  private state = makeState('idle');
  private readonly listeners = new Set<(state: InferenceState) => void>();

  submit(request: {
    requestId?: string;
    conversationId?: string;
    originatingUserMessageId?: string;
    assistantMessageId?: string;
    imagePath: string | null;
    question: string;
  }): Promise<void> {
    this.submitted.push(request);
    return Promise.resolve();
  }

  cancel(): void {
    this.emit(makeState('cancelled'));
  }

  subscribe(listener: (state: InferenceState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): InferenceState {
    return this.state;
  }

  emit(state: InferenceState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

class ContractHistory implements IHistoryStore {
  readonly saved = new Map<string, Conversation>();

  save(conversation: Conversation): void {
    this.saved.set(conversation.id, conversation);
  }

  get(id: string): Conversation | null {
    return this.saved.get(id) ?? null;
  }

  list(): Conversation[] {
    return Array.from(this.saved.values());
  }

  delete(id: string): void {
    this.saved.delete(id);
  }

  clear(): void {
    this.saved.clear();
  }

  setFlag(id: string, flagged: boolean, note?: string): void {
    const conversation = this.get(id);
    if (conversation !== null) {
      this.save({ ...conversation, flagged, flagNote: note ?? null });
    }
  }

  getMetricsSummary(): MetricsSummary {
    return {
      count: 0,
      averageModelLoadTimeMs: 0,
      averagePreprocessingTimeMs: 0,
      averageFirstTokenLatencyMs: 0,
      averageTokensPerSecond: 0,
      averageTotalWallTimeMs: 0,
    };
  }
}

function makeState(status: InferenceState['status'], response = ''): InferenceState {
  return {
    status,
    response,
    metrics: null,
    error: status === 'errored' ? 'model failed' : null,
    limitWarning: null,
    pinnedExtraction: null,
    hiddenEvidence: null,
    objectiveResult: null,
    inferenceTrace: null,
  };
}

function makeSubject() {
  const queue = new ContractQueue();
  const history = new ContractHistory();
  const ids = [
    'request-a',
    'user-a',
    'assistant-a',
    'request-b',
    'user-b',
    'assistant-b',
    'request-retry',
  ];
  const store = createConversationStore({
    inferenceQueue: queue,
    historyStore: history,
    now: () => 1_700_000_000_000,
    createId: (prefix) => ids.shift() ?? `${prefix}-fallback`,
  });

  return { store, queue, history };
}

describe('conversation ownership contract', () => {
  it('maintains one active owner and rejects/no-ops for another conversation', async () => {
    const { store, history } = makeSubject();
    store.setDraftText('conversation-b', 'preserve me');

    const first = await store.submit('conversation-a', { question: 'A', imagePath: null });

    await expect(
      store.submit('conversation-b', { question: 'B', imagePath: null })
    ).rejects.toThrow(/in flight/i);

    expect(first).toEqual({
      conversationId: 'conversation-a',
      originatingUserMessageId: 'user-a',
      assistantMessageId: 'assistant-a',
    });
    expect(store.getActiveGenerationOwner()).toBe('conversation-a');
    expect(store.getConversationRuntimeState('conversation-a')?.isOwnerOfActiveInference).toBe(
      true
    );
    expect(store.getConversationRuntimeState('conversation-b')).toBeNull();
    expect(store.getDraft('conversation-b').text).toBe('preserve me');
    expect(history.get('conversation-b')).toBeNull();
  });

  it('keeps retry identity stable for the targeted failed assistant message', async () => {
    const { store, queue, history } = makeSubject();
    await store.submit('conversation-a', { question: 'A', imagePath: null });
    queue.emit(makeState('errored'));

    await store.retryFailedMessage('conversation-a', 'assistant-a');

    const conversation = history.get('conversation-a');
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[0]?.id).toBe('user-a');
    expect(conversation?.messages[1]?.id).toBe('assistant-a');
    expect(conversation?.messages[1]?.status).toBe('generating');
    expect(queue.submitted.at(-1)).toEqual(
      expect.objectContaining({
        requestId: 'request-b',
        conversationId: 'conversation-a',
        originatingUserMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
      })
    );
  });
});
