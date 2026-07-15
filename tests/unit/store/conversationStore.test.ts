jest.mock('../../../src/storage/mmkv', () => ({
  storage: {
    set: jest.fn(),
    getString: jest.fn(),
    getAllKeys: jest.fn((): string[] => []),
    remove: jest.fn(() => false),
  },
}));
jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));
jest.mock('../../../src/store/historyStore', () => ({
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

import { storage } from '../../../src/storage/mmkv';
import { createConversationStore } from '../../../src/store/conversationStore';
import type { IHistoryStore, IInferenceQueue } from '../../../src/types/interfaces';
import type {
  CanonicalConversationContext,
  Conversation,
  InferenceState,
  MetricsSummary,
} from '../../../src/types/models';

const ID_SEQUENCE = [
  'conversation-a',
  'request-a',
  'user-a',
  'assistant-a',
  'request-b',
  'user-b',
  'assistant-b',
  'request-retry',
];

class FakeInferenceQueue implements IInferenceQueue {
  readonly submitted: Array<{
    requestId?: string;
    conversationId?: string;
    originatingUserMessageId?: string;
    assistantMessageId?: string;
    imagePath: string | null;
    question: string;
  }> = [];
  readonly submittedContexts: Array<CanonicalConversationContext | undefined> = [];

  private state: InferenceState = makeInferenceState('idle');
  private readonly listeners = new Set<(state: InferenceState) => void>();

  submit = jest.fn((request, options?: { conversationContext?: CanonicalConversationContext }) => {
    this.submitted.push(request);
    this.submittedContexts.push(options?.conversationContext);
    return Promise.resolve();
  });

  cancel = jest.fn(() => {
    this.emit(makeInferenceState('cancelled'));
  });

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

class FakeHistoryStore implements IHistoryStore {
  readonly conversations = new Map<string, Conversation>();

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

function makeInferenceState(status: InferenceState['status'], response = ''): InferenceState {
  return {
    status,
    response,
    metrics:
      status === 'completed'
        ? {
            modelLoadTimeMs: 1,
            preprocessingTimeMs: 2,
            firstTokenLatencyMs: 3,
            tokensPerSecond: 4,
            totalWallTimeMs: 5,
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

function makeStore() {
  const queue = new FakeInferenceQueue();
  const history = new FakeHistoryStore();
  const ids = [...ID_SEQUENCE];
  const store = createConversationStore({
    inferenceQueue: queue,
    historyStore: history,
    now: () => 1_700_000_000_000,
    createId: () => ids.shift() ?? `id-${ids.length}`,
  });

  return { store, queue, history };
}

describe('conversationStore', () => {
  it('round-trips drafts independently and startNewConversation only resets the new draft', () => {
    const { store } = makeStore();

    store.setDraftText('conversation-a', 'existing draft');
    store.setDraftImage('conversation-a', '/a.jpg');
    store.setDraftText('new', 'new draft');
    store.setDraftImage('new', '/new.jpg');

    store.startNewConversation();

    expect(store.getDraft('conversation-a')).toEqual({
      conversationId: 'conversation-a',
      text: 'existing draft',
      imagePath: '/a.jpg',
    });
    expect(store.getDraft('new')).toEqual({
      conversationId: null,
      text: '',
      imagePath: null,
    });
  });

  it('submit appends a paired user and assistant message atomically and owns the active generation', async () => {
    const { store, queue, history } = makeStore();

    const result = await store.submit('new', {
      question: 'What is this?',
      imagePath: '/capture.jpg',
    });

    expect(result).toEqual({
      conversationId: 'conversation-a',
      originatingUserMessageId: 'user-a',
      assistantMessageId: 'assistant-a',
    });
    expect(store.getActiveGenerationOwner()).toBe('conversation-a');
    expect(store.isAnyGenerationInFlight()).toBe(true);
    expect(queue.submitted[0]).toEqual(
      expect.objectContaining({
        requestId: 'request-a',
        conversationId: 'conversation-a',
        originatingUserMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        imagePath: '/capture.jpg',
        question: 'What is this?',
      })
    );
    expect(history.get('conversation-a')?.messages.map((message) => message.id)).toEqual([
      'user-a',
      'assistant-a',
    ]);
  });

  it('continues without cross-chat context when a selected target was deleted', async () => {
    const queue = new FakeInferenceQueue();
    const history = new FakeHistoryStore();
    const ids = [...ID_SEQUENCE];
    const store = createConversationStore({
      inferenceQueue: queue,
      historyStore: history,
      now: () => 1_700_000_000_000,
      createId: () => ids.shift() ?? `id-${ids.length}`,
      targetResolver: { resolve: () => ({ kind: 'not-found' }) },
    });

    const result = await store.submit('new', {
      question: 'Use that trip conversation.',
      imagePath: null,
      conversationTargetId: 'deleted-conversation',
    });

    expect(result.targetNotice).toMatch(/no longer available/i);
    expect(queue.submitted).toHaveLength(1);
  });

  it('asks which past chat when ambiguous, then resumes with the chosen one', async () => {
    const queue = new FakeInferenceQueue();
    const history = new FakeHistoryStore();
    const ids = ['conversation-a', 'user-a', 'assistant-a', 'request-b', 'user-b', 'assistant-b'];
    const store = createConversationStore({
      inferenceQueue: queue,
      historyStore: history,
      now: () => 1_700_000_000_000,
      createId: () => ids.shift() ?? `id-${ids.length}`,
      targetResolver: {
        resolve: () => ({
          kind: 'ambiguous',
          candidates: [
            { id: 'japan', title: 'Japan trip', createdAt: 1, updatedAt: 2 },
            { id: 'japan2', title: 'Japan plans', createdAt: 1, updatedAt: 3 },
          ],
        }),
      },
    });

    // Ambiguous reference -> a clarification turn is posted, no generation runs.
    const first = await store.submit('new', {
      question: 'Do you remember our previous chats?',
      imagePath: null,
    });
    expect(queue.submitted).toHaveLength(0);
    expect(store.isAnyGenerationInFlight()).toBe(false);
    const assistant = history
      .get(first.conversationId)
      ?.messages.find((message) => message.role === 'assistant');
    expect(assistant?.status).toBe('completed');
    expect(assistant?.text).toMatch(/Japan trip/);
    expect(assistant?.text).toMatch(/Japan plans/);

    // The next reply selects a remembered candidate and generation resumes.
    const second = await store.submit(first.conversationId, { question: '2', imagePath: null });
    expect(second.conversationId).toBe(first.conversationId);
    expect(queue.submitted).toHaveLength(1);
  });

  it('records a benchmark only for a completed attempt, never a failed one', async () => {
    const queue = new FakeInferenceQueue();
    const history = new FakeHistoryStore();
    const ids = [...ID_SEQUENCE];
    const recordBenchmark = jest.fn();
    const store = createConversationStore({
      inferenceQueue: queue,
      historyStore: history,
      now: () => 1_700_000_000_000,
      createId: () => ids.shift() ?? `id-${ids.length}`,
      recordBenchmark,
    });

    await store.submit('new', { question: 'Text only.', imagePath: null });
    queue.emit(makeInferenceState('errored'));
    expect(recordBenchmark).not.toHaveBeenCalled();

    await store.submit('conversation-a', { question: 'Try again.', imagePath: null });
    queue.emit(makeInferenceState('completed', 'The answer.'));
    expect(recordBenchmark).toHaveBeenCalledTimes(1);
    expect(recordBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'text', conversationId: 'conversation-a' })
    );
  });

  it('snapshots completed canonical turns for every follow-up in chronological order', async () => {
    const { store, queue } = makeStore();

    const first = await store.submit('new', {
      question: 'Give me two deployment options.',
      imagePath: null,
    });
    queue.emit(makeInferenceState('completed', '1. Local APK.\n2. Managed EAS build.'));

    await store.submit(first.conversationId, {
      question: 'Which one is easier to maintain?',
      imagePath: null,
    });

    expect(queue.submittedContexts[1]).toEqual({
      version: 'canonical-conversation-v2',
      recentTurns: [
        {
          question: 'Give me two deployment options.',
          answer: '1. Local APK.\n2. Managed EAS build.',
        },
      ],
      mediaEvidence: [],
      importantFacts: [],
      olderSummary: null,
      budget: {
        policyId: 'character-budget-v1',
        maximumUnits: 7_000,
        usedUnits: 130,
      },
    });
  });

  it('persists image evidence and reuses it in a later follow-up context', async () => {
    const { store, queue, history } = makeStore();
    const first = await store.submit('new', {
      question: 'What text is visible?',
      imagePath: '/capture/receipt.jpg',
    });
    queue.emit({
      ...makeInferenceState('completed', 'The receipt shows order A-184.'),
      hiddenEvidence: {
        version: 'hidden-evidence-v1',
        imagePath: '/capture/receipt.jpg',
        sourceQuestion: 'What text is visible?',
        subjectObject: 'printed receipt',
        visibleFeatures: ['white paper'],
        visibleText: ['Order A-184'],
        visibleCondition: 'readable',
        uncertainty: [],
        createdAt: '2026-07-10T12:00:00.000Z',
      },
    });

    expect(history.get(first.conversationId)?.contextMemory?.mediaEvidence[0]).toEqual(
      expect.objectContaining({
        sourceMessageId: first.originatingUserMessageId,
        summary: 'printed receipt',
        extractedText: ['Order A-184'],
      }),
    );

    await store.submit(first.conversationId, {
      question: 'Which order identifier was shown?',
      imagePath: null,
    });

    expect(queue.submittedContexts[1]?.mediaEvidence[0]).toEqual(
      expect.objectContaining({
        sourceMessageId: first.originatingUserMessageId,
        extractedText: ['Order A-184'],
      }),
    );
  });

  it('rejects a submit elsewhere while preserving that conversation draft and messages', async () => {
    const { store, history } = makeStore();
    await store.submit('new', { question: 'A question', imagePath: null });
    store.setDraftText('conversation-b', 'do not clear me');
    store.setDraftImage('conversation-b', '/b.jpg');

    await expect(
      store.submit('conversation-b', { question: 'Second question', imagePath: null })
    ).rejects.toThrow(/in flight/i);

    expect(store.getDraft('conversation-b')).toEqual({
      conversationId: 'conversation-b',
      text: 'do not clear me',
      imagePath: '/b.jpg',
    });
    expect(history.get('conversation-b')).toBeNull();
  });

  it('only mutates the owning runtime state when streaming changes arrive', async () => {
    const { store, queue } = makeStore();
    await store.submit('new', { question: 'A question', imagePath: null });

    queue.emit(makeInferenceState('streaming', 'partial answer'));

    expect(store.getConversationRuntimeState('conversation-a')).toEqual(
      expect.objectContaining({
        conversationId: 'conversation-a',
        assistantMessageId: 'assistant-a',
        streamingText: 'partial answer',
        isOwnerOfActiveInference: true,
      })
    );
    expect(store.getConversationRuntimeState('conversation-b')).toBeNull();
  });

  it('checkpoints streaming text on a throttle and flushes the latest text on stop', async () => {
    const queue = new FakeInferenceQueue();
    const history = new FakeHistoryStore();
    let now = 1_000;
    const checkpoints: Array<{ id: string; text: string }> = [];
    const store = createConversationStore({
      inferenceQueue: queue,
      historyStore: history,
      now: () => now,
      checkpointAssistantText: (id, text) => checkpoints.push({ id, text }),
    });

    const result = await store.submit('new', { question: 'A question', imagePath: null });
    queue.emit(makeInferenceState('streaming', 'first partial'));
    queue.emit(makeInferenceState('streaming', 'second partial'));
    expect(checkpoints).toEqual([{ id: result.assistantMessageId, text: 'first partial' }]);

    now += 1_000;
    queue.emit(makeInferenceState('cancelled'));
    expect(checkpoints).toEqual([
      { id: result.assistantMessageId, text: 'first partial' },
      { id: result.assistantMessageId, text: 'second partial' },
    ]);
    expect(history.get(result.conversationId)?.messages[1]).toEqual(
      expect.objectContaining({ status: 'interrupted', text: 'second partial' })
    );
  });

  it('retryFailedMessage preserves the failed attempt and appends a new active attempt', async () => {
    const { store, queue, history } = makeStore();
    await store.submit('new', { question: 'A question', imagePath: null });
    queue.emit(makeInferenceState('errored'));

    await store.retryFailedMessage('conversation-a', 'assistant-a');

    const conversation = history.get('conversation-a');
    expect(conversation?.messages.map((message) => message.id)).toEqual([
      'user-a', 'assistant-a', 'request-b',
    ]);
    expect(conversation?.messages[1]).toEqual(
      expect.objectContaining({ id: 'assistant-a', status: 'failed' })
    );
    expect(conversation?.messages[2]).toEqual(
      expect.objectContaining({
        id: 'request-b',
        status: 'generating',
        errorMessage: null,
      })
    );
    expect(queue.submitted.at(-1)).toEqual(
      expect.objectContaining({
        requestId: 'user-b',
        conversationId: 'conversation-a',
        originatingUserMessageId: 'user-a',
        assistantMessageId: 'request-b',
      })
    );
  });

  it('retries an interrupted attempt without overwriting its partial text', async () => {
    const { store, queue, history } = makeStore();
    await store.submit('new', { question: 'A question', imagePath: null });
    queue.emit(makeInferenceState('streaming', 'partial before stop'));
    queue.emit(makeInferenceState('cancelled'));

    await store.retryFailedMessage('conversation-a', 'assistant-a');

    expect(history.get('conversation-a')?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'assistant-a', status: 'interrupted', text: 'partial before stop' }),
        expect.objectContaining({ status: 'generating' }),
      ])
    );
  });

  it('persists a bounded diagnostic turn record when a dev trace completes', async () => {
    const setSpy = jest.spyOn(storage, 'set');
    setSpy.mockClear();
    const { store, queue } = makeStore();
    await store.submit('new', { question: 'What is this?', imagePath: '/capture.jpg' });

    queue.emit({
      ...makeInferenceState('completed', 'It is a mug.'),
      inferenceTrace: {
        id: 'trace-1',
        createdAt: '2026-07-10T00:00:00.000Z',
        stages: [],
        finalResponse: 'It is a mug.',
      },
    });

    const recordCall = setSpy.mock.calls.find(([key]) =>
      String(key).startsWith('diagnostics:turn:record:'),
    );
    expect(recordCall).toBeDefined();
    const persisted: unknown = JSON.parse(String(recordCall?.[1]));
    expect(persisted).toEqual(
      expect.objectContaining({
        conversationId: 'conversation-a',
        originatingUserMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
      }),
    );
  });

  it('does not persist a diagnostic turn when no trace was captured', async () => {
    const setSpy = jest.spyOn(storage, 'set');
    setSpy.mockClear();
    const { store, queue } = makeStore();
    await store.submit('new', { question: 'What is this?', imagePath: '/capture.jpg' });

    queue.emit(makeInferenceState('completed', 'It is a mug.'));

    const recordCall = setSpy.mock.calls.find(([key]) =>
      String(key).startsWith('diagnostics:turn:record:'),
    );
    expect(recordCall).toBeUndefined();
  });
});
