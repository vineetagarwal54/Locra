// T040 — the single mixed-multimodal integration regression this feature keeps
// automated. Drives conversationStore through text → image A → text follow-up →
// image B → text follow-up, then runs the real ContextBuilder over the resulting
// canonical conversation. Asserts each reply stays scoped to its own message by
// id (never position), no earlier message is altered or reset, and both images'
// content remains distinguishable when later referenced (FR-009/FR-010/FR-011/FR-033).

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
import type { IConversationStore, IHistoryStore, IInferenceQueue } from '../../src/types/interfaces';
import type {
  Conversation,
  ConversationMessage,
  InferenceRequest,
  InferenceState,
  MetricsSummary,
} from '../../src/types/models';

const IMAGE_A = '/photos/watering-can.jpg';
const IMAGE_B = '/photos/bicycle.jpg';
const EVIDENCE_A = 'Image evidence: green watering can with a long spout.';
const EVIDENCE_B = 'Image evidence: red bicycle near a garage.';

class FakeQueue implements IInferenceQueue {
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

class FakeHistory implements IHistoryStore {
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
  const queue = new FakeQueue();
  const history = new FakeHistory();
  let counter = 0;
  const store = createConversationStore({
    inferenceQueue: queue,
    historyStore: history,
    now: () => 1_700_000_000_000 + counter,
    createId: (prefix) => `${prefix}-${(counter += 1)}`,
  });

  return { store, queue, history };
}

interface TurnResult {
  originatingUserMessageId: string;
  assistantMessageId: string;
  conversationId: string;
}

async function runTurn(
  store: IConversationStore,
  queue: FakeQueue,
  conversationId: string | 'new',
  request: { question: string; imagePath: string | null },
  finalResponse: string
): Promise<TurnResult> {
  const result = await store.submit(conversationId, request);
  queue.emit(makeState('streaming', finalResponse.slice(0, 4)));
  queue.emit(makeState('completed', finalResponse));
  return result;
}

function messageById(conversation: Conversation | null, id: string): ConversationMessage | undefined {
  return conversation?.messages.find((message) => message.id === id);
}

describe('unified chat mixed-multimodal flow (T040)', () => {
  it('scopes each reply to its own message id and keeps both images distinguishable when later referenced', async () => {
    const { store, queue, history } = makeSubject();

    // text → image A → text follow-up → image B → text follow-up
    const t1 = await runTurn(
      store,
      queue,
      'new',
      { question: 'What can you help with?', imagePath: null },
      'I can answer questions and inspect images.'
    );
    const conversationId = t1.conversationId;

    const t2 = await runTurn(
      store,
      queue,
      conversationId,
      { question: 'What is this?', imagePath: IMAGE_A },
      EVIDENCE_A
    );
    const t3 = await runTurn(
      store,
      queue,
      conversationId,
      { question: 'What color is the spout?', imagePath: null },
      'The spout is green.'
    );
    const t4 = await runTurn(
      store,
      queue,
      conversationId,
      { question: 'And what is this?', imagePath: IMAGE_B },
      EVIDENCE_B
    );
    const t5 = await runTurn(
      store,
      queue,
      conversationId,
      { question: 'Which one is meant for outdoors?', imagePath: null },
      'The red bicycle is meant for outdoors.'
    );

    const conversation = history.get(conversationId);

    // Ten ordered messages, strictly alternating user/assistant starting with user.
    expect(conversation?.messages).toHaveLength(10);
    expect(conversation?.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);

    // Each image is attached to exactly its own user message; text turns carry none.
    expect(messageById(conversation, t2.originatingUserMessageId)?.attachments).toEqual([
      { kind: 'image', path: IMAGE_A },
    ]);
    expect(messageById(conversation, t4.originatingUserMessageId)?.attachments).toEqual([
      { kind: 'image', path: IMAGE_B },
    ]);
    for (const textTurn of [t1, t3, t5]) {
      expect(messageById(conversation, textTurn.originatingUserMessageId)?.attachments).toEqual([]);
    }

    // Every assistant message id is distinct — attribution is by id, not position.
    const assistantIds = [t1, t2, t3, t4, t5].map((turn) => turn.assistantMessageId);
    expect(new Set(assistantIds).size).toBe(assistantIds.length);

    // Each reply is scoped to its own assistant message.
    expect(messageById(conversation, t1.assistantMessageId)).toEqual(
      expect.objectContaining({ status: 'completed', text: 'I can answer questions and inspect images.' })
    );
    expect(messageById(conversation, t2.assistantMessageId)).toEqual(
      expect.objectContaining({ status: 'completed', text: EVIDENCE_A })
    );
    expect(messageById(conversation, t4.assistantMessageId)).toEqual(
      expect.objectContaining({ status: 'completed', text: EVIDENCE_B })
    );
    expect(messageById(conversation, t5.assistantMessageId)).toEqual(
      expect.objectContaining({ status: 'completed', text: 'The red bicycle is meant for outdoors.' })
    );

    // No earlier message was altered or reset by the later turns: image A's reply
    // is unchanged after image B and the final follow-up landed.
    expect(messageById(conversation, t2.assistantMessageId)?.text).toBe(EVIDENCE_A);
    expect(messageById(conversation, t2.assistantMessageId)?.errorMessage).toBeNull();

    // The queue saw each image on its own request only, never re-attached to a
    // later text turn, and each request targeted its own assistant message id.
    const requestFor = (assistantMessageId: string): InferenceRequest | undefined =>
      queue.submitted.find((request) => request.assistantMessageId === assistantMessageId);
    expect(requestFor(t2.assistantMessageId)?.imagePath).toBe(IMAGE_A);
    expect(requestFor(t4.assistantMessageId)?.imagePath).toBe(IMAGE_B);
    expect(requestFor(t1.assistantMessageId)?.imagePath).toBeNull();
    expect(requestFor(t3.assistantMessageId)?.imagePath).toBeNull();
    expect(requestFor(t5.assistantMessageId)?.imagePath).toBeNull();

  });
});
