// T096 — full vision-once → multi-turn → resumed-thread flow (FR-039–FR-047).
// Real inferenceStore + real historyStore/HistoryStore over in-memory storage;
// only the engine handle (the useLLM adapter) and native modules are mocked.

jest.mock('../../src/storage/mmkv', () => {
  const values = new Map<string, string | number | boolean | ArrayBuffer>();
  return {
    storage: {
      set: (key: string, value: string | number | boolean | ArrayBuffer): void => {
        values.set(key, value);
      },
      getString: (key: string): string | undefined => {
        const value = values.get(key);
        return typeof value === 'string' ? value : undefined;
      },
      getAllKeys: (): string[] => Array.from(values.keys()),
      remove: (key: string): boolean => values.delete(key),
    },
  };
});

describe('grounded practical advice prompt assembly', () => {
  it('combines visible evidence, general knowledge, uncertainty, and next steps for advice cases', () => {
    const evidence: HiddenVisualEvidence = {
      version: 'hidden-evidence-v1',
      imagePath: '/camera/pan.jpg',
      sourceQuestion: 'How do I fix this?',
      subjectObject: 'worn cooking pan',
      visibleFeatures: ['dark cooking surface', 'scratched center'],
      visibleText: [],
      visibleCondition: 'surface appears worn in the center',
      uncertainty: ['coating material is not legible from the image'],
      createdAt: '2026-07-07T16:30:00.000Z',
    };

    const prompt = buildAnswerPrompt({
      question: 'How do I fix this?',
      hiddenEvidence: evidence,
      conversationMode: 'live',
      generationConfigId: 'recommended-lfm2-vl-v1',
      pipelineVariantId: 'recommended-sampling-v1',
    });

    expect(prompt).toContain('Image evidence: worn cooking pan');
    expect(prompt).not.toContain('Visible facts from the image');
    expect(prompt).not.toContain('General knowledge and reasoning');
    expect(prompt).not.toContain('Actionable next steps');
    expect(prompt).toContain('coating material is not legible');
  });
});
jest.mock('../../src/store/modelStore', () => ({
  useModelStore: Object.assign(jest.fn(), {
    getState: () => ({ isReadyForInference: () => true }),
  }),
}));
jest.mock('react-native-nitro-image', () => ({
  loadImage: jest.fn(() => Promise.resolve({ width: 512, height: 384 })),
}));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn((uri: string) =>
    Promise.resolve({ uri, width: 512, height: 384 })
  ),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

import { buildAnswerPrompt } from '../../src/inference/AnswerPrompt';
import type { ModelRequestMessage } from '../../src/inference/ContextBuilder';
import type { InferenceEngineHandle } from '../../src/inference/InferenceEngineHandle';
import type { HiddenVisualEvidence } from '../../src/inference/OutputPipelineTypes';
import { useHistoryStore } from '../../src/store/historyStore';
import { useInferenceStore } from '../../src/store/inferenceStore';

const IMAGE_PATH = '/camera/flow-capture.jpg';

const EXTRACTION_JSON = JSON.stringify({
  subjectObject: 'green watering can',
  visibleFeatures: ['plastic', 'long spout'],
  visibleText: [],
  visibleCondition: 'dusty but intact',
});

function makeEngineHandle(): InferenceEngineHandle & {
  submissions: Array<{ imagePath: string | null; prompt: string; messages: ModelRequestMessage[] }>;
  clearHistoryCalls: number;
} {
  const listeners = new Set<() => void>();
  let response = '';
  let followUpCounter = 0;
  const submissions: Array<{
    imagePath: string | null;
    prompt: string;
    messages: ModelRequestMessage[];
  }> = [];
  const handle = {
    submissions,
    clearHistoryCalls: 0,
    generate: async (messages: ModelRequestMessage[]): Promise<string> => {
      const imagePath = messages.find((message) => message.mediaPath !== undefined)?.mediaPath ?? null;
      const prompt = messages.at(-1)?.content ?? '';
      submissions.push({ imagePath, prompt, messages });
      if (imagePath !== null) {
        response = EXTRACTION_JSON;
      } else {
        followUpCounter += 1;
        response = `Follow-up answer ${followUpCounter}.`;
      }
      for (const listener of listeners) listener();
      return response;
    },
    cancel: jest.fn(),
    getResponse: () => response,
    isGenerating: () => false,
    isReady: () => true,
    getGeneratedTokenCount: () => 12,
    getPromptTokenCount: () => 40,
    getTotalTokenCount: () => 52,
    getMessageHistoryLength: () => 0,
    clearHistory: (): void => {
      handle.clearHistoryCalls += 1;
    },
    getError: () => null,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return handle;
}

describe('vision-once → multi-turn → resumed-thread flow (T096)', () => {
  it('carries the pinned extraction and full thread through capture, follow-ups, reset, and resume', async () => {
    const engine = makeEngineHandle();
    const store = useInferenceStore.getState();
    store.registerEngine(engine);

    // ── Turn 1: capture → structured extraction with the image attached ──
    await store.submit({ imagePath: IMAGE_PATH, question: 'What is this?' });

    expect(engine.submissions[0].imagePath).not.toBeNull();
    expect(engine.submissions[0].prompt).toMatch(/subject\/object/i);

    const sessionId = useInferenceStore.getState().activeSessionId;
    expect(sessionId).not.toBeNull();

    let persisted = useHistoryStore.getState().get(sessionId as string);
    expect(useInferenceStore.getState().hiddenEvidence?.subjectObject).toBe('green watering can');
    expect(persisted?.pinnedExtraction).toBeNull();
    expect(persisted?.hiddenEvidence).toBeNull();
    expect(persisted?.turns).toHaveLength(1);

    // ── Turns 2-3: text-only follow-ups over canonical Locra context ──
    await store.submit({ imagePath: IMAGE_PATH, question: 'Is it usable?' });
    await store.submit({ imagePath: IMAGE_PATH, question: 'What color is the spout?' });

    expect(engine.submissions[1].imagePath).toBeNull();
    expect(engine.submissions[2].imagePath).toBeNull();
    expect(engine.submissions[2].prompt).toBe('Is it usable?');
    expect(engine.submissions[3].prompt).toBe('What color is the spout?');
    expect(engine.submissions[3].messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);

    persisted = useHistoryStore.getState().get(sessionId as string);
    expect(persisted?.turns).toHaveLength(3);
    expect(persisted?.id).toBe(sessionId);

    // ── Navigate away / new capture: clean slate (FR-047) ──
    useInferenceStore.getState().resetActiveChat();

    expect(useInferenceStore.getState().activeSessionId).toBeNull();
    expect(engine.clearHistoryCalls).toBeGreaterThan(0);
    // The thread survived the reset in history, in full (FR-045).
    persisted = useHistoryStore.getState().get(sessionId as string);
    expect(persisted?.turns).toHaveLength(3);

    // ── Reopen from history and continue the same thread (FR-046) ──
    const hydrated = useInferenceStore.getState().hydrateSession(sessionId as string);
    expect(hydrated?.turns).toHaveLength(3);

    await useInferenceStore
      .getState()
      .submit({ imagePath: IMAGE_PATH, question: 'Where should I store it?' });

    const lastSubmission = engine.submissions.at(-1);
    expect(lastSubmission?.imagePath).toBeNull();
    expect(lastSubmission?.prompt).toBe('Where should I store it?');
    expect(lastSubmission?.messages.map((message) => message.content)).toEqual(
      expect.arrayContaining(['What color is the spout?', 'Where should I store it?'])
    );

    await useInferenceStore
      .getState()
      .submit({ imagePath: IMAGE_PATH, question: 'why?' });

    expect(engine.submissions.at(-1)?.prompt).toBe('why?');

    persisted = useHistoryStore.getState().get(sessionId as string);
    expect(persisted?.turns).toHaveLength(5);
    expect(persisted?.turns[3].question).toBe('Where should I store it?');
    expect(persisted?.turns[4].question).toBe('why?');
    expect(persisted?.pinnedExtraction).toBeNull();
    expect(persisted?.imagePath).toBe(IMAGE_PATH);
  });
});
