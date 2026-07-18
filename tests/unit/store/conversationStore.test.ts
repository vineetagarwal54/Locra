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

  it('persists an attached image before saving or submitting its path', async () => {
    const queue = new FakeInferenceQueue();
    const history = new FakeHistoryStore();
    const persistImage = jest.fn(async () =>
      '/documents/locra-conversations/conversation-a/images/durable.jpg');
    const ids = [...ID_SEQUENCE];
    const store = createConversationStore({
      inferenceQueue: queue,
      historyStore: history,
      now: () => 1_700_000_000_000,
      createId: () => ids.shift() ?? `id-${ids.length}`,
      persistImage,
    });

    await store.submit('new', { question: 'What is this?', imagePath: '/cache/capture.jpg' });

    expect(persistImage).toHaveBeenCalledWith('conversation-a', '/cache/capture.jpg');
    expect(queue.submitted[0]?.imagePath).toBe(
      '/documents/locra-conversations/conversation-a/images/durable.jpg',
    );
    expect(history.get('conversation-a')?.messages[0]?.attachments[0]?.path).toBe(
      '/documents/locra-conversations/conversation-a/images/durable.jpg',
    );
  });

  it('treats references to another chat as ordinary same-chat prompts', async () => {
    const { store, queue } = makeStore();

    await store.submit('new', {
      question: 'Use the details from my previous trip chat.',
      imagePath: null,
    });

    expect(queue.submitted).toHaveLength(1);
    expect(queue.submitted[0]?.question).toBe('Use the details from my previous trip chat.');
    expect(queue.submitted[0]).not.toHaveProperty('conversationTargetId');
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

  it('starts a retry from empty streaming text and never resurrects the prior partial', async () => {
    const { store, queue, history } = makeStore();
    await store.submit('new', { question: 'A question', imagePath: null });
    queue.emit(makeInferenceState('streaming', 'old partial'));
    queue.emit(makeInferenceState('errored'));

    await store.retryFailedMessage('conversation-a', 'assistant-a');

    // The new attempt begins blank and the runtime shows no carried-over text.
    expect(history.get('conversation-a')?.messages.at(-1)?.text).toBe('');
    expect(store.getConversationRuntimeState('conversation-a')?.streamingText).toBe('');

    // A retry that errors before producing anything must not inherit 'old partial'.
    queue.emit(makeInferenceState('errored'));
    const newAttempt = history.get('conversation-a')?.messages.at(-1);
    expect(newAttempt?.status).toBe('failed');
    expect(newAttempt?.text).toBe('');
    // The original failed attempt still keeps its own partial (immutable history).
    expect(
      history.get('conversation-a')?.messages.find((message) => message.id === 'assistant-a')?.text,
    ).toBe('old partial');
  });

  it('persists the completed finish reason on the assistant message', async () => {
    const { store, queue, history } = makeStore();
    await store.submit('new', { question: 'A question', imagePath: null });

    queue.emit({ ...makeInferenceState('completed', 'Answer'), finishReason: 'length' });

    expect(history.get('conversation-a')?.messages[1]).toEqual(
      expect.objectContaining({ status: 'completed', finishReason: 'length' }),
    );
  });

  it('maps a cancelled turn to a cancelled finish reason regardless of engine report', async () => {
    const { store, queue, history } = makeStore();
    await store.submit('new', { question: 'A question', imagePath: null });

    queue.emit(makeInferenceState('cancelled'));

    expect(history.get('conversation-a')?.messages[1]?.finishReason).toBe('cancelled');
  });

  it('continues a length-truncated answer as a linked attempt seeded with the shown text', async () => {
    const { store, queue, history } = makeStore();
    await store.submit('new', { question: 'Explain X', imagePath: null });
    queue.emit({
      ...makeInferenceState('completed', 'Partial answer that was cut'),
      finishReason: 'length',
    });

    await store.continueTruncatedMessage('conversation-a', 'assistant-a');

    // A new linked attempt is appended; the truncated attempt is preserved.
    const conversation = history.get('conversation-a');
    expect(conversation?.messages.map((message) => message.id)).toEqual([
      'user-a', 'assistant-a', 'request-b',
    ]);
    // The runtime shows the already-visible text immediately (no empty restart).
    expect(store.getConversationRuntimeState('conversation-a')?.streamingText).toBe(
      'Partial answer that was cut',
    );
    // The continuation prompt embeds the original question + partial, as a text turn.
    const submitted = queue.submitted.at(-1);
    expect(submitted?.imagePath).toBeNull();
    expect(submitted?.question).toMatch(/continuing your own previous answer/i);
    expect(submitted?.question).toContain('Partial answer that was cut');

    // The completed continuation stitches seed + new text without repetition.
    queue.emit(makeInferenceState('completed', ' and here is the rest.'));
    expect(history.get('conversation-a')?.messages.at(-1)?.text).toBe(
      'Partial answer that was cut and here is the rest.',
    );
  });

  it('refuses to continue an answer that stopped naturally', async () => {
    const { store, queue } = makeStore();
    await store.submit('new', { question: 'Explain X', imagePath: null });
    queue.emit({ ...makeInferenceState('completed', 'Complete answer.'), finishReason: 'natural' });

    await expect(
      store.continueTruncatedMessage('conversation-a', 'assistant-a'),
    ).rejects.toThrow(/cannot be continued/i);
  });

  it('regenerates a completed answer as a fresh linked attempt, preserving the original', async () => {
    const { store, queue, history } = makeStore();
    await store.submit('new', { question: 'Explain X', imagePath: null });
    queue.emit(makeInferenceState('completed', 'First answer'));

    await store.regenerateResponse('conversation-a', 'assistant-a');

    const conversation = history.get('conversation-a');
    // The original completed attempt is preserved unchanged.
    expect(
      conversation?.messages.find((message) => message.id === 'assistant-a'),
    ).toEqual(expect.objectContaining({ text: 'First answer', status: 'completed' }));
    // The new attempt is a fresh generation: blank, original question, no seed.
    expect(conversation?.messages.at(-1)?.status).toBe('generating');
    expect(conversation?.messages.at(-1)?.text).toBe('');
    expect(store.getConversationRuntimeState('conversation-a')?.streamingText).toBe('');
    expect(queue.submitted.at(-1)?.question).toBe('Explain X');
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

  it('persists a production-safe diagnostic summary when no raw trace was captured', async () => {
    const setSpy = jest.spyOn(storage, 'set');
    setSpy.mockClear();
    const { store, queue } = makeStore();
    await store.submit('new', { question: 'What is this?', imagePath: '/capture.jpg' });

    queue.emit(makeInferenceState('completed', 'It is a mug.'));

    const recordCall = setSpy.mock.calls.find(([key]) =>
      String(key).startsWith('diagnostics:turn:record:'),
    );
    expect(recordCall).toBeDefined();
    const persisted = JSON.parse(String(recordCall?.[1])) as {
      trace: unknown;
      summary: { responseMode: string; targetTokenCount: number; generationLimit: number };
    };
    expect(persisted.trace).toBeNull();
    expect(persisted.summary).toEqual(expect.objectContaining({
      responseMode: 'Medium', targetTokenCount: 384, generationLimit: 640,
    }));
  });

  it.each([
    ['Low', 192, 320, 4000],
    ['Medium', 384, 640, 7000],
    ['High', 768, 1024, 11000],
  ] as const)('records %s mode configuration in diagnostics', async (
    mode, targetTokenCount, generationLimit, budgetMaximumUnits,
  ) => {
    const setSpy = jest.spyOn(storage, 'set');
    setSpy.mockClear();
    const { store, queue } = makeStore();
    store.setResponseMode('new', mode);
    await store.submit('new', { question: 'Explain a refrigerator.', imagePath: null });
    queue.emit(makeInferenceState('completed', 'A refrigerator moves heat outside.'));

    const recordCall = [...setSpy.mock.calls].reverse().find(([key]) =>
      String(key).startsWith('diagnostics:turn:record:'),
    );
    const persisted = JSON.parse(String(recordCall?.[1])) as {
      summary: {
        responseMode: string;
        targetTokenCount: number;
        generationLimit: number;
        contextSelection: { budgetMaximumUnits: number };
      };
    };
    expect(persisted.summary).toEqual(expect.objectContaining({
      responseMode: mode, targetTokenCount, generationLimit,
    }));
    expect(persisted.summary.contextSelection.budgetMaximumUnits).toBe(budgetMaximumUnits);
  });
});
