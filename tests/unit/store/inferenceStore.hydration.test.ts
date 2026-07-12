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
    getState: () => ({
      selectedModelId: 'LFM2_5_VL_1_6B_QUANTIZED',
      isReadyForInference: () => true,
    }),
  }),
}));
jest.mock('../../../src/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ responseMode: 'Medium' }) },
}));
// This suite validates the ExecuTorch/LFM attribution path, so pin the host to
// ExecuTorch (Qwen is now the default V1 runtime).
jest.mock('../../../src/inference/StartupRuntimeSelection', () => ({
  getStartupRuntimeSelection: () => ({
    selectedHost: 'executorch',
    source: 'internal_startup_config',
    processLocked: true,
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

import type { ModelRequestMessage } from '../../../src/inference/ContextBuilder';
import type { EngineGenerateRequest, InferenceEngineHandle } from '../../../src/inference/InferenceEngineHandle';
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
  submissions: Array<{ imagePath: string | null; prompt: string; messages: ModelRequestMessage[] }>;
  clearHistoryCalls: number;
} {
  const listeners = new Set<() => void>();
  let response = '';
  const submissions: Array<{
    imagePath: string | null;
    prompt: string;
    messages: ModelRequestMessage[];
  }> = [];
  const handle = {
    submissions,
    clearHistoryCalls: 0,
    generate: async (request: EngineGenerateRequest): Promise<string> => {
      const messages = request.messages;
      const imagePath = messages.find((message) => message.mediaPath !== undefined)?.mediaPath ?? null;
      const prompt = messages.at(-1)?.content ?? '';
      submissions.push({ imagePath, prompt, messages });
      if (imagePath !== null) {
        response = HIDDEN_EVIDENCE_JSON;
      } else if (prompt.includes('Image evidence:')) {
        response = FIRST_VISIBLE_ANSWER;
      } else {
        response = 'It is about ten centimeters tall.';
      }
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

    // Text-only turn with canonical persisted turns supplied as separate messages.
    expect(engine.submissions).toHaveLength(1);
    expect(engine.submissions[0].imagePath).toBeNull();
    expect(engine.submissions[0].messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(engine.submissions[0].prompt).toBe('How tall is it?');

    const saved = historyMock.mockSave.mock.calls.at(-1)?.[0] as QASession;
    expect(saved.id).toBe('sess-2');
    expect(saved.turns).toHaveLength(3);
    expect(saved.turns[2].question).toBe('How tall is it?');
    expect(saved.pinnedExtraction).toBeNull();
    expect(saved.hiddenEvidence).toBeNull();
  });

  it('active live follow-ups send only the new message and do not duplicate app history', async () => {
    const engine = makeEngineHandle();
    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore
      .getState()
      .submit({ conversationId: 'live-chat', imagePath: '/photos/live.jpg', question: 'What is this?' });
    await useInferenceStore
      .getState()
      .submit({ conversationId: 'live-chat', imagePath: '/photos/live.jpg', question: 'shorter' });

    expect(engine.submissions[1]).toEqual(
      expect.objectContaining({ imagePath: null, prompt: 'shorter' })
    );
    expect(engine.submissions[1].messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(engine.submissions[1].messages.map((message) => message.content).join('\n')).not.toContain(
      'Conversation so far'
    );
  });

  it('resumed sessions reconstruct once, then return to send-only-new-message follow-ups', async () => {
    const session = makePersistedSession('sess-resume-once', '/photos/resume-once.jpg');
    historyMock.mockSessions.set(session.id, session);
    const engine = makeEngineHandle();
    useInferenceStore.getState().registerEngine(engine);
    useInferenceStore.getState().hydrateSession(session.id);

    await useInferenceStore
      .getState()
      .submit({ imagePath: session.imagePath, question: 'explain more' });
    await useInferenceStore
      .getState()
      .submit({ imagePath: session.imagePath, question: 'what should I do next?' });

    expect(engine.submissions[0].messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(engine.submissions[0].prompt).toBe('explain more');
    expect(engine.submissions[1]).toEqual(
      expect.objectContaining({
        imagePath: null,
        prompt: 'what should I do next?',
      })
    );
  });

  it('keeps short live follow-ups stable for a long conversation window', async () => {
    const engine = makeEngineHandle();
    const imagePath = '/photos/long-live.jpg';
    const followUps = [
      'shorter',
      'why?',
      'explain more',
      'what should I do next?',
      'make it simpler',
      'any risks?',
      'one sentence',
      'compare options',
      'what about the handle?',
      'give steps',
      'more detail',
      'summarize',
    ];
    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore.getState().submit({ conversationId: 'long-chat', imagePath, question: 'What is this?' });
    for (const question of followUps) {
      await useInferenceStore.getState().submit({ conversationId: 'long-chat', imagePath, question });
    }

    const liveFollowUpPrompts = engine.submissions.slice(1).map((submission) => submission.prompt);
    expect(liveFollowUpPrompts).toEqual(followUps);
    expect(liveFollowUpPrompts.join('\n')).not.toContain('Conversation so far');
    expect(liveFollowUpPrompts.join('\n')).not.toContain(PINNED);
  });

  it('persists the final first-turn answer without adding hidden perception as a normal turn', async () => {
    const engine = makeEngineHandle();
    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore
      .getState()
      .submit({ conversationId: 'first-turn', imagePath: '/photos/first-turn.jpg', question: 'Read the text on this form.' });

    const saved = historyMock.mockSave.mock.calls.at(-1)?.[0] as QASession;
    expect(engine.submissions).toHaveLength(2);
    expect(engine.submissions[0].imagePath).toBe('/photos/first-turn.jpg');
    expect(engine.submissions[0].prompt).toMatch(/valid json only/i);
    expect(engine.submissions[1].imagePath).toBeNull();
    expect(engine.submissions[1].prompt).toContain('Image evidence: ceramic mug');
    expect(saved.answer).toBe(FIRST_VISIBLE_ANSWER);
    expect(saved.turns).toEqual([
      { question: 'Read the text on this form.', answer: FIRST_VISIBLE_ANSWER },
    ]);
    expect(saved.turns[0].answer).not.toMatch(/Subject\/object|visibleFeatures|subjectObject/i);
  });

  it('persists hidden visual evidence separately from the visible answer', async () => {
    const engine = makeEngineHandle();
    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore
      .getState()
      .submit({ conversationId: 'hidden', imagePath: '/photos/hidden.jpg', question: 'Read the text on this form.' });

    const saved = historyMock.mockSave.mock.calls.at(-1)?.[0] as QASession;
    expect(useInferenceStore.getState().hiddenEvidence?.subjectObject).toBe('ceramic mug');
    expect(saved.pinnedExtraction).toBeNull();
    expect(saved.hiddenEvidence).toBeNull();
    expect(saved.answer).toBe(FIRST_VISIBLE_ANSWER);
  });

  it('bridges the completed production objective result for dev-only consumers without saving it to history', async () => {
    const engine = makeEngineHandle();
    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore
      .getState()
      .submit({ conversationId: 'objective', imagePath: '/photos/objective.jpg', question: 'Read the text on this form.' });

    const state = useInferenceStore.getState();
    const saved = historyMock.mockSave.mock.calls.at(-1)?.[0] as QASession;
    expect(state.currentObjectiveResult).toEqual(
      expect.objectContaining({
        answerText: FIRST_VISIBLE_ANSWER,
        pipelineVariantId: 'recommended-sampling-v1',
        modelId: 'QWEN3_VL_2B_INSTRUCT_Q4_K_M',
        generationConfigId: 'qwen3-vl-2b-instruct-llamarn-v1',
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

  it('HistoryScreen cards navigate to the chat screen keyed by conversation id', () => {
    const source = read('src/screens/HistoryScreen.tsx');
    expect(source).toMatch(/navigate\('Chat',\s*\{\s*conversationId/);
  });

  it('ChatScreen subscribes to conversation runtime without cancelling on unmount', () => {
    const source = read('src/screens/ChatScreen.tsx');
    expect(source).toContain('subscribeToConversation');
    expect(source).toContain('assistantMessageId');
    // The runtime subscription effect returns the unsubscribe directly — it never
    // cancels generation on unmount (T030). The only cancel is the explicit,
    // user-triggered Stop control (T049).
    expect(source).toMatch(/return conversationStore\.subscribeToConversation\(/);
  });

  it('CaptureScreen writes a captured image into the route-scoped draft owner', () => {
    const source = read('src/screens/CaptureScreen.tsx');
    expect(source).toContain('route.params.conversationId');
    expect(source).toContain('conversationStore.setDraftImage');
    expect(source).not.toContain('useInferenceStore');
    expect(source).not.toContain('.submit(');
  });
});
