jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));
jest.mock('../../src/storage/mmkv', () => ({
  storage: {
    set: jest.fn(),
    getString: jest.fn(),
    getAllKeys: jest.fn((): string[] => []),
    remove: jest.fn(() => false),
  },
}));
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

import type { PreprocessedImage } from '../../src/inference/ImagePreprocessor';
import {
  InferenceQueue,
  type EngineGenerateRequest,
  type InferenceEngineAdapter,
} from '../../src/inference/InferenceQueue';
import { createConversationStore } from '../../src/store/conversationStore';
import type { IHistoryStore } from '../../src/types/interfaces';
import type {
  Conversation,
  InferenceState,
  MetricsSummary,
} from '../../src/types/models';

class MemoryHistory implements IHistoryStore {
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

const extractionJson = JSON.stringify({
  subjectObject: 'printed shipping label',
  visibleFeatures: ['white adhesive label'],
  visibleText: ['Tracking code LK-2048'],
  visibleCondition: 'flat and readable',
  uncertainty: [],
});

function preprocess(imagePath: string): Promise<PreprocessedImage> {
  return Promise.resolve({ path: `${imagePath}.prepared`, width: 512, height: 384 });
}

function waitForTerminalState(queue: InferenceQueue): Promise<InferenceState> {
  return new Promise((resolve) => {
    const unsubscribe = queue.subscribe((state) => {
      if (state.status === 'completed' || state.status === 'errored') {
        unsubscribe();
        resolve(state);
      }
    });
  });
}

describe('ContextOrchestrator full inference flow', () => {
  it('reuses structured evidence from a prior image turn in a text follow-up', async () => {
    const generatedRequests: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (request, onToken) => {
        generatedRequests.push(request);
        const response = request.kind === 'extraction'
          ? extractionJson
          : request.kind === 'answer'
            ? 'The label shows tracking code LK-2048.'
            : 'The tracking code was LK-2048.';
        onToken(response, 8);
        return Promise.resolve({ response, tokenCount: 8 });
      },
    };
    const queue = new InferenceQueue({
      preprocess,
      isReadyForInference: () => true,
      engine,
    });
    const history = new MemoryHistory();
    let id = 0;
    const store = createConversationStore({
      inferenceQueue: queue,
      historyStore: history,
      now: () => 1_700_000_000_000 + id,
      createId: (prefix) => `${prefix}-${(id += 1)}`,
    });

    const firstTerminal = waitForTerminalState(queue);
    const first = await store.submit('new', {
      question: 'What code is on this label?',
      imagePath: '/images/label.jpg',
    });
    await firstTerminal;

    expect(history.get(first.conversationId)?.contextMemory?.mediaEvidence[0]).toEqual(
      expect.objectContaining({
        sourceMessageId: first.originatingUserMessageId,
        extractedText: ['Tracking code LK-2048'],
      }),
    );

    const followUpTerminal = waitForTerminalState(queue);
    await store.submit(first.conversationId, {
      question: 'What was the tracking code?',
      imagePath: null,
    });
    await followUpTerminal;

    const followUpRequest = generatedRequests.at(-1);
    expect(followUpRequest?.kind).toBe('chat');
    expect(followUpRequest?.messages.some((message) => message.mediaPath !== undefined)).toBe(false);
    expect(followUpRequest?.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(followUpRequest?.messages[0]?.content).toContain('Relevant prior media evidence');
    expect(followUpRequest?.messages[0]?.content).toContain('Tracking code LK-2048');
    expect(followUpRequest?.messages.at(-1)?.content).toBe('What was the tracking code?');
  });
});
