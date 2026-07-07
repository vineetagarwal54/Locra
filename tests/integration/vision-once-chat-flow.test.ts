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

import type { InferenceEngineHandle } from '../../src/inference/useInferenceEngine';
import { useHistoryStore } from '../../src/store/historyStore';
import { useInferenceStore } from '../../src/store/inferenceStore';

const IMAGE_PATH = '/camera/flow-capture.jpg';

const EXTRACTION_JSON = JSON.stringify({
  subjectObject: 'green watering can',
  visibleFeatures: ['plastic', 'long spout'],
  visibleText: [],
  visibleCondition: 'dusty but intact',
});

const PINNED = [
  'Subject/object: green watering can',
  'Visible features: plastic, long spout',
  'Visible text: None visible',
  'Visible condition: dusty but intact',
].join('\n');

function makeEngineHandle(): InferenceEngineHandle & {
  submissions: Array<{ imagePath: string | null; prompt: string }>;
  clearHistoryCalls: number;
} {
  const listeners = new Set<() => void>();
  let response = '';
  let messageHistoryLength = 0;
  let followUpCounter = 0;
  const submissions: Array<{ imagePath: string | null; prompt: string }> = [];
  const handle = {
    submissions,
    clearHistoryCalls: 0,
    submit: async (imagePath: string | null, prompt: string): Promise<string> => {
      submissions.push({ imagePath, prompt });
      if (imagePath !== null) {
        response = EXTRACTION_JSON;
      } else {
        followUpCounter += 1;
        response = `Follow-up answer ${followUpCounter}.`;
      }
      messageHistoryLength += 2;
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
    getMessageHistoryLength: () => messageHistoryLength,
    clearHistory: (): void => {
      handle.clearHistoryCalls += 1;
      messageHistoryLength = 0;
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
    expect(persisted?.pinnedExtraction).toBe(PINNED);
    expect(persisted?.turns).toHaveLength(1);

    // ── Turns 2–3: text-only follow-ups over the pinned context ──
    await store.submit({ imagePath: IMAGE_PATH, question: 'Is it usable?' });
    await store.submit({ imagePath: IMAGE_PATH, question: 'What color is the spout?' });

    expect(engine.submissions[1].imagePath).toBeNull();
    expect(engine.submissions[2].imagePath).toBeNull();
    expect(engine.submissions[2].prompt).toContain(PINNED);
    expect(engine.submissions[2].prompt).toContain('Is it usable?');

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
    expect(lastSubmission?.prompt).toContain(PINNED);
    expect(lastSubmission?.prompt).toContain('What color is the spout?');
    expect(lastSubmission?.prompt).toContain('Where should I store it?');

    persisted = useHistoryStore.getState().get(sessionId as string);
    expect(persisted?.turns).toHaveLength(4);
    expect(persisted?.turns[3].question).toBe('Where should I store it?');
    expect(persisted?.pinnedExtraction).toBe(PINNED);
    expect(persisted?.imagePath).toBe(IMAGE_PATH);
  });
});
