jest.mock('../../../src/store/historyStore', () => {
  const sessions = new Map<string, unknown>();
  return {
    mockSessions: sessions,
    mockSave: jest.fn((session: { id: string }): void => {
      sessions.set(session.id, session);
    }),
    useHistoryStore: Object.assign(jest.fn(), {
      getState: () => {
        const self = jest.requireMock('../../../src/store/historyStore') as {
          mockSessions: Map<string, unknown>;
          mockSave: jest.Mock;
        };
        return {
          save: self.mockSave,
          get: (id: string) => self.mockSessions.get(id) ?? null,
        };
      },
    }),
  };
});
jest.mock('../../../src/store/modelStore', () => ({
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

import { readFileSync } from 'fs';
import { join } from 'path';

import type { InferenceEngineHandle } from '../../../src/inference/useInferenceEngine';
import { useInferenceStore } from '../../../src/store/inferenceStore';
import type { QASession } from '../../../src/types/models';

interface HistoryMock {
  mockSessions: Map<string, QASession>;
  mockSave: jest.Mock;
}

const historyMock = jest.requireMock('../../../src/store/historyStore') as HistoryMock;

const PINNED = [
  'Subject/object: ceramic mug',
  'Visible features: blue glaze, chipped handle',
  'Visible text: None visible',
  'Visible condition: used, clean',
].join('\n');
const HIDDEN_EVIDENCE_JSON = JSON.stringify({
  subjectObject: 'ceramic mug',
  visibleFeatures: ['blue glaze', 'chipped handle'],
  visibleText: [],
  visibleCondition: 'used, clean',
  uncertainty: ['exact size is unclear from the image'],
});
const FIRST_VISIBLE_ANSWER = 'It is a ceramic mug with a chipped handle.';

function makePersistedSession(id: string, imagePath: string): QASession {
  return {
    id,
    createdAt: 1700000000000,
    imagePath,
    question: 'What is this?',
    answer: PINNED,
    turns: [
      { question: 'What is this?', answer: PINNED },
      { question: 'Is it damaged?', answer: 'The handle is chipped.' },
    ],
    pinnedExtraction: PINNED,
    status: 'completed',
    errorMessage: null,
    metrics: {
      modelLoadTimeMs: 100,
      preprocessingTimeMs: 50,
      firstTokenLatencyMs: 900,
      tokensPerSecond: 8,
      totalWallTimeMs: 4000,
    },
    flagged: false,
    flagNote: null,
  };
}

function makeEngineHandle(): InferenceEngineHandle & {
  submissions: Array<{ imagePath: string | null; prompt: string }>;
  clearHistoryCalls: number;
} {
  const listeners = new Set<() => void>();
  let response = '';
  let messageHistoryLength = 0;
  const submissions: Array<{ imagePath: string | null; prompt: string }> = [];
  const handle = {
    submissions,
    clearHistoryCalls: 0,
    submit: async (imagePath: string | null, prompt: string): Promise<string> => {
      submissions.push({ imagePath, prompt });
      if (imagePath !== null) {
        response = HIDDEN_EVIDENCE_JSON;
      } else if (prompt.includes('Visible facts from the image')) {
        response = FIRST_VISIBLE_ANSWER;
      } else {
        response = 'It is about ten centimeters tall.';
      }
      messageHistoryLength += 2;
      for (const listener of listeners) listener();
      return response;
    },
    cancel: jest.fn(),
    getResponse: () => response,
    isGenerating: () => false,
    isReady: () => true,
    getGeneratedTokenCount: () => 8,
    getPromptTokenCount: () => 10,
    getTotalTokenCount: () => 18,
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

describe('chat-thread hydration and reset (FR-045, FR-046, FR-047)', () => {
  beforeEach(() => {
    historyMock.mockSessions.clear();
    historyMock.mockSave.mockClear();
    useInferenceStore.getState().resetActiveChat();
    useInferenceStore.getState().registerEngine(null);
  });

  it('hydrateSession loads the full persisted turn list and activates the thread', () => {
    const session = makePersistedSession('sess-1', '/photos/mug.jpg');
    historyMock.mockSessions.set(session.id, session);

    const hydrated = useInferenceStore.getState().hydrateSession('sess-1');

    expect(hydrated).not.toBeNull();
    expect(hydrated?.turns).toHaveLength(2);
    expect(useInferenceStore.getState().activeSessionId).toBe('sess-1');
  });

  it('hydrateSession returns null for an unknown id and leaves no active thread', () => {
    const hydrated = useInferenceStore.getState().hydrateSession('missing');

    expect(hydrated).toBeNull();
    expect(useInferenceStore.getState().activeSessionId).toBeNull();
  });

  it('a follow-up after hydration in a fresh process appends to the SAME session id without hanging', async () => {
    const session = makePersistedSession('sess-2', '/photos/mug2.jpg');
    historyMock.mockSessions.set(session.id, session);
    const engine = makeEngineHandle();
    useInferenceStore.getState().registerEngine(engine);
    useInferenceStore.getState().hydrateSession('sess-2');

    await useInferenceStore
      .getState()
      .submit({ imagePath: session.imagePath, question: 'How tall is it?' });

    // Text-only turn on the long-lived instance, prompt self-contained.
    expect(engine.submissions).toHaveLength(1);
    expect(engine.submissions[0].imagePath).toBeNull();
    expect(engine.submissions[0].prompt).toContain(PINNED);
    expect(engine.submissions[0].prompt).toContain('Is it damaged?');
    expect(engine.submissions[0].prompt).toContain('How tall is it?');

    const saved = historyMock.mockSave.mock.calls.at(-1)?.[0] as QASession;
    expect(saved.id).toBe('sess-2');
    expect(saved.turns).toHaveLength(3);
    expect(saved.turns[2].question).toBe('How tall is it?');
    expect(saved.pinnedExtraction).toBe(PINNED);
  });

  it('persists the final first-turn answer without adding hidden perception as a normal turn', async () => {
    const engine = makeEngineHandle();
    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore
      .getState()
      .submit({ imagePath: '/photos/first-turn.jpg', question: 'What is this?' });

    const saved = historyMock.mockSave.mock.calls.at(-1)?.[0] as QASession;
    expect(engine.submissions).toHaveLength(2);
    expect(engine.submissions[0].imagePath).toBe('/photos/first-turn.jpg');
    expect(engine.submissions[0].prompt).toMatch(/valid json only/i);
    expect(engine.submissions[1].imagePath).toBeNull();
    expect(engine.submissions[1].prompt).toContain('Visible facts from the image');
    expect(saved.answer).toBe(FIRST_VISIBLE_ANSWER);
    expect(saved.turns).toEqual([
      { question: 'What is this?', answer: FIRST_VISIBLE_ANSWER },
    ]);
    expect(saved.turns[0].answer).not.toMatch(/Subject\/object|visibleFeatures|subjectObject/i);
  });

  it('persists hidden visual evidence separately from the visible answer', async () => {
    const engine = makeEngineHandle();
    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore
      .getState()
      .submit({ imagePath: '/photos/hidden.jpg', question: 'What is this?' });

    const saved = historyMock.mockSave.mock.calls.at(-1)?.[0] as QASession;
    expect(saved.pinnedExtraction).toContain('Subject/object: ceramic mug');
    expect(saved.hiddenEvidence?.subjectObject).toBe('ceramic mug');
    expect(saved.hiddenEvidence?.sourceQuestion).toBe('What is this?');
    expect(saved.hiddenEvidence?.visibleFeatures).toContain('chipped handle');
    expect(saved.answer).toBe(FIRST_VISIBLE_ANSWER);
  });

  it('bridges the completed production objective result for dev-only consumers without saving it to history', async () => {
    const engine = makeEngineHandle();
    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore
      .getState()
      .submit({ imagePath: '/photos/objective.jpg', question: 'What is this?' });

    const state = useInferenceStore.getState();
    const saved = historyMock.mockSave.mock.calls.at(-1)?.[0] as QASession;
    expect(state.currentObjectiveResult).toEqual(
      expect.objectContaining({
        answerText: FIRST_VISIBLE_ANSWER,
        pipelineVariantId: 'recommended-sampling-v1',
        generationConfigId: 'recommended-lfm2-vl-v1',
      }),
    );
    expect(saved).not.toHaveProperty('currentObjectiveResult');
    expect(saved).not.toHaveProperty('objectiveResult');
  });

  it('resetActiveChat clears the thread, wipes engine history, and the next capture starts a new session', async () => {
    const engine = makeEngineHandle();
    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore
      .getState()
      .submit({ imagePath: '/photos/first.jpg', question: 'What is this?' });
    const firstId = (historyMock.mockSave.mock.calls.at(-1)?.[0] as QASession).id;

    useInferenceStore.getState().resetActiveChat();

    expect(useInferenceStore.getState().activeSessionId).toBeNull();
    expect(useInferenceStore.getState().status).toBe('idle');
    expect(engine.clearHistoryCalls).toBeGreaterThan(0);

    await useInferenceStore
      .getState()
      .submit({ imagePath: '/photos/second.jpg', question: 'And this?' });
    const secondSaved = historyMock.mockSave.mock.calls.at(-1)?.[0] as QASession;

    expect(secondSaved.id).not.toBe(firstId);
    expect(secondSaved.turns).toHaveLength(1);
    // The new thread's first turn re-runs vision — image attached again.
    expect(engine.submissions.at(-2)?.imagePath).not.toBeNull();
  });

  it('completing a first turn records its session id as the active thread', async () => {
    const engine = makeEngineHandle();
    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore
      .getState()
      .submit({ imagePath: '/photos/active.jpg', question: 'What is this?' });

    const savedId = (historyMock.mockSave.mock.calls.at(-1)?.[0] as QASession).id;
    expect(useInferenceStore.getState().activeSessionId).toBe(savedId);
  });
});

describe('screen wiring for resumable threads (FR-046, FR-047, FR-048)', () => {
  const read = (relativePath: string): string =>
    readFileSync(join(process.cwd(), relativePath), 'utf8');

  it('HistoryScreen cards navigate to the chat screen keyed by session id', () => {
    const source = read('src/screens/HistoryScreen.tsx');
    expect(source).toMatch(/navigate\('Answer',\s*\{\s*sessionId/);
  });

  it('AnswerScreen hydrates from a sessionId param and interrupts on unmount', () => {
    const source = read('src/screens/AnswerScreen.tsx');
    expect(source).toContain('hydrateSession');
    expect(source).toContain('sessionId');
    // FR-048: unmount cleanup cancels any in-flight generation.
    expect(source).toMatch(/return \(\) => \{[\s\S]*cancel/);
  });

  it('CaptureScreen resets the active chat when it gains focus (clean slate per capture)', () => {
    const source = read('src/screens/CaptureScreen.tsx');
    expect(source).toContain('resetActiveChat');
    expect(source).toMatch(/addListener\('focus'/);
  });
});
