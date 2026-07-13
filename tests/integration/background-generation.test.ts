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
import type {
  Conversation,
  InferenceRequest,
  InferenceState,
  MetricsSummary,
} from '../../src/types/models';

class BackgroundQueue implements IInferenceQueue {
  readonly submitted: InferenceRequest[] = [];
  private state = makeState('idle');
  private readonly listeners = new Set<(state: InferenceState) => void>();

  submit(request: InferenceRequest): Promise<void> {
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

class BackgroundHistory implements IHistoryStore {
  private readonly conversations = new Map<string, Conversation>();

  save(conversation: Conversation): void {
    this.conversations.set(conversation.id, conversation);
  }

  get(id: string): Conversation | null {
    return this.conversations.get(id) ?? null;
  }

  list(): Conversation[] {
    return Array.from(this.conversations.values());
  }

  delete(id: string): void {
    this.conversations.delete(id);
  }

  clear(): void {
    this.conversations.clear();
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
    metrics:
      status === 'completed'
        ? {
            modelLoadTimeMs: 10,
            preprocessingTimeMs: 20,
            firstTokenLatencyMs: 30,
            tokensPerSecond: 4,
            totalWallTimeMs: 40,
          }
        : null,
    error: status === 'errored' ? 'failed' : null,
    limitWarning: null,
    pinnedExtraction: null,
    hiddenEvidence: null,
    objectiveResult: null,
    inferenceTrace: null,
  };
}

function makeSubject() {
  const queue = new BackgroundQueue();
  const history = new BackgroundHistory();
  let counter = 0;
  const store = createConversationStore({
    inferenceQueue: queue,
    historyStore: history,
    now: () => 1_700_000_000_000 + counter,
    createId: (prefix) => `${prefix}-${(counter += 1)}`,
  });

  return { store, queue, history };
}

function findMessage(conversation: Conversation | null, messageId: string) {
  return conversation?.messages.find((message) => message.id === messageId);
}

describe('background generation ownership', () => {
  it('attributes generation, blocking, completion, live return, cancel, and repeat submit by assistant id', async () => {
    const { store, queue, history } = makeSubject();
    store.setDraftText('conversation-b', 'B draft');
    store.setDraftImage('conversation-b', '/b.jpg');

    const first = await store.submit('conversation-a', { question: 'Describe A', imagePath: null });
    expect(first.assistantMessageId).toBe('assistant-message-3');

    queue.emit(makeState('streaming', 'partial A'));
    expect(store.getConversationRuntimeState('conversation-a')).toEqual(
      expect.objectContaining({
        assistantMessageId: first.assistantMessageId,
        streamingText: 'partial A',
        isOwnerOfActiveInference: true,
      })
    );
    expect(store.getConversationRuntimeState('conversation-b')).toBeNull();

    await expect(
      store.submit('conversation-b', { question: 'Describe B', imagePath: null })
    ).rejects.toThrow(/in flight/i);
    expect(store.getDraft('conversation-b')).toEqual({
      conversationId: 'conversation-b',
      text: 'B draft',
      imagePath: '/b.jpg',
    });
    expect(history.get('conversation-b')).toBeNull();

    expect(findMessage(history.get('conversation-a'), first.assistantMessageId)).toEqual(
      expect.objectContaining({ status: 'generating' })
    );

    queue.emit(makeState('completed', 'final A'));
    expect(findMessage(history.get('conversation-a'), first.assistantMessageId)).toEqual(
      expect.objectContaining({
        id: first.assistantMessageId,
        status: 'completed',
        text: 'final A',
      })
    );
    expect(store.getConversationRuntimeState('conversation-b')).toBeNull();

    const second = await store.submit('conversation-a', {
      question: 'Another A',
      imagePath: null,
    });
    queue.emit(makeState('streaming', 'live A again'));
    expect(store.getConversationRuntimeState('conversation-a')).toEqual(
      expect.objectContaining({
        assistantMessageId: second.assistantMessageId,
        streamingText: 'live A again',
        isOwnerOfActiveInference: true,
      })
    );

    store.cancelActiveGeneration('conversation-a');
    expect(findMessage(history.get('conversation-a'), second.assistantMessageId)).toEqual(
      expect.objectContaining({
        id: second.assistantMessageId,
        status: 'interrupted',
      })
    );
    expect(store.isAnyGenerationInFlight()).toBe(false);

    const bSubmit = await store.submit('conversation-b', {
      question: 'Now B can run',
      imagePath: null,
    });
    expect(bSubmit.conversationId).toBe('conversation-b');

    await expect(
      store.submit('conversation-b', { question: 'Repeated B', imagePath: null })
    ).rejects.toThrow(/in flight/i);
    expect(
      queue.submitted.filter((request) => request.conversationId === 'conversation-b')
    ).toHaveLength(1);
    expect(history.get('conversation-b')?.messages.map((message) => message.id)).toEqual([
      bSubmit.originatingUserMessageId,
      bSubmit.assistantMessageId,
    ]);
  });
});
