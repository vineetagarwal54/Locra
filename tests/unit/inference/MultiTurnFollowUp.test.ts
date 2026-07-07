jest.mock('../../../src/store/historyStore', () => ({
  mockSavedSessions: [],
  mockSave: jest.fn((session: unknown): void => {
    const self = jest.requireMock('../../../src/store/historyStore') as HistoryStoreMock;
    self.mockSavedSessions.push(session);
  }),
  useHistoryStore: Object.assign(jest.fn(), {
    getState: () => {
      const self = jest.requireMock('../../../src/store/historyStore') as HistoryStoreMock;
      return { save: self.mockSave };
    },
  }),
}));
jest.mock('../../../src/store/modelStore', () => ({
  useModelStore: Object.assign(jest.fn(), {
    getState: () => ({ isReadyForInference: () => true }),
  }),
}));
jest.mock('react-native-nitro-image', () => ({
  loadImage: jest.fn(() =>
    Promise.resolve({
      width: 512,
      height: 384,
    })
  ),
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  RESPONSE_LIMIT_WARNING_TOKEN_THRESHOLD,
  RESPONSE_TOKEN_BUDGET,
  getResponseLimitWarning,
} from '../../../src/inference/GenerationLimits';
import type { PreprocessedImage } from '../../../src/inference/ImagePreprocessor';
import {
  InferenceQueue,
  type EngineGenerateRequest,
  type InferenceEngineAdapter,
} from '../../../src/inference/InferenceQueue';
import type { InferenceEngineHandle } from '../../../src/inference/useInferenceEngine';
import { useInferenceStore } from '../../../src/store/inferenceStore';
import type { InferenceRequest, QASession } from '../../../src/types/models';

interface HistoryStoreMock {
  mockSavedSessions: unknown[];
  mockSave: jest.Mock<void, [unknown]>;
}

const historyStoreMock = jest.requireMock(
  '../../../src/store/historyStore'
) as HistoryStoreMock;

interface FollowUpSubmitter {
  submit(request: InferenceRequest, options?: { turn: 'followUp' }): Promise<void>;
}

const firstRequest: InferenceRequest = {
  imagePath: '/camera/original.jpg',
  question: 'What is on the desk?',
};

const followUpRequest: InferenceRequest = {
  imagePath: firstRequest.imagePath,
  question: 'What color is it?',
};

const extractionJson = JSON.stringify({
  subjectObject: 'black notebook',
  visibleFeatures: ['rectangular', 'matte cover'],
  visibleText: [],
  visibleCondition: 'closed on a desk',
  uncertainty: ['brand is not visible'],
});
const extractionAnswer = [
  'Subject/object: black notebook',
  'Visible features: rectangular, matte cover',
  'Visible text: None visible',
  'Visible condition: closed on a desk',
].join('\n');
const firstVisibleAnswer = 'It is a black notebook closed on the desk.';

function preprocess(imagePath: string): Promise<PreprocessedImage> {
  return Promise.resolve({
    path: `${imagePath}.preprocessed`,
    width: 512,
    height: 384,
  });
}

describe('multi-turn follow-up exchanges', () => {
  beforeEach(() => {
    historyStoreMock.mockSavedSessions.length = 0;
    historyStoreMock.mockSave.mockClear();
    useInferenceStore.getState().registerEngine(null);
  });

  it('passes the image path only on the first turn; follow-up turns are text-only', async () => {
    const generatedRequests: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: jest.fn(() => Promise.resolve()),
      generate: (request, onToken) => {
        generatedRequests.push(request);
        const response = generatedRequests.length === 1
          ? extractionJson
          : generatedRequests.length === 2
            ? 'A notebook.'
            : 'It is black.';
        onToken(response);
        return Promise.resolve({ response, tokenCount: 3 });
      },
    };
    const queue = new InferenceQueue({
      preprocess,
      isReadyForInference: () => true,
      engine,
    });

    await queue.submit(firstRequest);
    await (queue as FollowUpSubmitter).submit(followUpRequest, { turn: 'followUp' });

    expect(generatedRequests[0]).toEqual(
      expect.objectContaining({
        imagePath: '/camera/original.jpg.preprocessed',
        kind: 'extraction',
        originalQuestion: firstRequest.question,
      })
    );
    expect(generatedRequests[0].question).toMatch(/subject\/object/i);
    expect(generatedRequests[1]).toEqual(
      expect.objectContaining({
        kind: 'answer',
        originalQuestion: firstRequest.question,
      })
    );
    expect(generatedRequests[1].imagePath).toBeUndefined();
    expect(generatedRequests[1].question).toContain('Visible facts from the image');
    expect(generatedRequests[2]).toEqual(
      {
        question: followUpRequest.question,
      }
    );
  });

  it('persists pinned extraction and includes it in the follow-up context prompt', async () => {
    const pinnedFirstRequest = withImagePath('/camera/pinned-original.jpg');
    const pinnedFollowUpRequest = {
      imagePath: pinnedFirstRequest.imagePath,
      question: followUpRequest.question,
    };
    const engine = makeEngineHandle();

    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore.getState().submit(pinnedFirstRequest);
    await useInferenceStore.getState().submit(pinnedFollowUpRequest);

    const savedSessions = historyStoreMock.mockSavedSessions as QASession[];
    expect(savedSessions[0].pinnedExtraction).toBe(extractionAnswer);
    expect(savedSessions[1].pinnedExtraction).toBe(extractionAnswer);
    expect(engine.submissions[2]).toEqual(
      expect.objectContaining({
        imagePath: null,
        historyLengthBefore: 2,
      })
    );
    expect(engine.submissions[2].prompt).toContain(extractionAnswer);
    expect(engine.submissions[2].prompt).toContain(pinnedFollowUpRequest.question);
  });

  it('keeps pinned extraction in follow-up context after many turns exceed the recent window', async () => {
    const windowFirstRequest = withImagePath('/camera/window-original.jpg');
    const engine = makeEngineHandle();

    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore.getState().submit(windowFirstRequest);
    for (let index = 0; index < 7; index += 1) {
      await useInferenceStore.getState().submit({
        imagePath: windowFirstRequest.imagePath,
        question: `Follow-up ${index}`,
      });
    }

    const lastPrompt = engine.submissions[engine.submissions.length - 1].prompt;
    expect(lastPrompt).toContain(extractionAnswer);
    expect(lastPrompt).toContain('Follow-up 6');
    expect(lastPrompt).not.toContain('Follow-up 0');
  });

  it('persists the full turns array as one history entry under the first session id', async () => {
    const fullFirstRequest = withImagePath('/camera/full-original.jpg');
    const fullFollowUpRequest = {
      imagePath: fullFirstRequest.imagePath,
      question: followUpRequest.question,
    };
    const engine = makeEngineHandle();

    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore.getState().submit(fullFirstRequest);
    await useInferenceStore.getState().submit(fullFollowUpRequest);

    const savedSessions = historyStoreMock.mockSavedSessions as QASession[];
    expect(historyStoreMock.mockSave).toHaveBeenCalledTimes(2);
    expect(savedSessions).toHaveLength(2);
    expect(savedSessions[1].id).toBe(savedSessions[0].id);
    expect(savedSessions[1].turns).toEqual([
      { question: fullFirstRequest.question, answer: firstVisibleAnswer },
      {
        question: fullFollowUpRequest.question,
        answer: 'It is black.',
      },
    ]);
    expect(engine.submissions[0]).toEqual(
      expect.objectContaining({
        imagePath: fullFirstRequest.imagePath,
        historyLengthBefore: 0,
      })
    );
    expect(engine.submissions[0].prompt).toMatch(/subject\/object/i);
    expect(engine.submissions[2].prompt).toContain(extractionAnswer);
  });

  it('uses useLLM managed messageHistory for follow-up context instead of manual history or a new load', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/useInferenceEngine.ts'),
      'utf8'
    );
    const navigatorSource = readFileSync(
      join(process.cwd(), 'src/navigation/AppNavigator.tsx'),
      'utf8'
    );

    expect(source).toContain('messageHistory');
    expect(source).toContain('SlidingWindowContextStrategy');
    expect(source).toContain('RESPONSE_TOKEN_BUDGET');
    expect(source).toMatch(/sendMessage\(prompt\)/);
    expect(source).toMatch(/sendMessage\(prompt,\s*\{\s*imagePath\s*\}\)/);
    expect(source).not.toMatch(/\.generate\(/);
    expect(countMatches(source, /\buseLLM\(/g)).toBe(1);
    expect(source).toContain('configuredRef.current = true');
    expect(source).toMatch(
      /configuredRef\.current \|\| !current\.isReady \|\| current\.messageHistory\.length > 0/
    );
    expect(navigatorSource).toContain('engineHostMounted');
    expect(navigatorSource).not.toContain('engineReady ? <InferenceEngineHost /> : null');
    expect(RESPONSE_TOKEN_BUDGET).toBeGreaterThan(512);
  });

  it('waits for managed turn 1 history before completing and sending turn 2', async () => {
    const delayedFirstRequest: InferenceRequest = {
      imagePath: '/camera/delayed-original.jpg',
      question: firstRequest.question,
    };
    const delayedFollowUpRequest: InferenceRequest = {
      imagePath: delayedFirstRequest.imagePath,
      question: followUpRequest.question,
    };
    const engine = makeEngineHandle({ historyUpdateDelayMs: 50 });

    useInferenceStore.getState().registerEngine(engine);

    const firstSubmit = useInferenceStore.getState().submit(delayedFirstRequest);
    await flushUntil(() => engine.submissions.length > 0);

    expect(engine.submissions[0]).toEqual(
      expect.objectContaining({
        imagePath: delayedFirstRequest.imagePath,
        historyLengthBefore: 0,
      })
    );
    expect(historyStoreMock.mockSave).not.toHaveBeenCalled();

    await sleep(40);
    expect(historyStoreMock.mockSave).not.toHaveBeenCalled();

    await firstSubmit;

    await useInferenceStore.getState().submit(delayedFollowUpRequest);

    expect(engine.submissions[2]).toEqual(
      expect.objectContaining({
        imagePath: null,
        historyLengthBefore: 2,
      })
    );
    expect(engine.submissions[2].prompt).toContain(delayedFollowUpRequest.question);
  });

  it('persists the resolved final response even when streamed hook state is behind', async () => {
    const isolatedRequest: InferenceRequest = {
      ...firstRequest,
      imagePath: '/camera/second-original.jpg',
    };
    const engine = makeEngineHandle({
      firstStreamedResponse: '{"subjectObject":"black',
      firstFinalResponse: extractionJson,
    });

    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore.getState().submit(isolatedRequest);

    const savedSessions = historyStoreMock.mockSavedSessions as QASession[];
    expect(savedSessions[0].answer).toBe(firstVisibleAnswer);
    expect(savedSessions[0].turns).toEqual([
      { question: isolatedRequest.question, answer: firstVisibleAnswer },
    ]);
  });

  it('warns when generated tokens approach the configured response budget', () => {
    expect(getResponseLimitWarning(RESPONSE_LIMIT_WARNING_TOKEN_THRESHOLD - 1)).toBeNull();
    expect(getResponseLimitWarning(RESPONSE_LIMIT_WARNING_TOKEN_THRESHOLD)).not.toBeNull();
  });
});

function makeEngineHandle(
  options: {
    firstStreamedResponse?: string;
    firstFinalResponse?: string;
    historyUpdateDelayMs?: number;
  } = {}
): InferenceEngineHandle & {
  submissions: Array<{ imagePath: string | null; prompt: string; historyLengthBefore: number }>;
} {
  const listeners = new Set<() => void>();
  let response = '';
  let tokenCount = 0;
  let messageHistoryLength = 0;
  const submissions: Array<{
    imagePath: string | null;
    prompt: string;
    historyLengthBefore: number;
  }> = [];

  return {
    submissions,
    submit: async (imagePath: string | null, prompt: string): Promise<string> => {
      submissions.push({ imagePath, prompt, historyLengthBefore: messageHistoryLength });
      const isExtractionTurn = imagePath !== null;
      const isAnswerTurn = imagePath === null && prompt.includes('Visible facts from the image');
      const finalResponse = isExtractionTurn
        ? options.firstFinalResponse ?? extractionJson
        : isAnswerTurn
          ? firstVisibleAnswer
        : 'It is black.';
      response = isExtractionTurn ? options.firstStreamedResponse ?? finalResponse : finalResponse;
      tokenCount = finalResponse.split(' ').length;
      const publishHistoryUpdate = (): void => {
        messageHistoryLength += 2;
        for (const listener of listeners) {
          listener();
        }
      };
      if (options.historyUpdateDelayMs === undefined) {
        publishHistoryUpdate();
      } else {
        setTimeout(publishHistoryUpdate, options.historyUpdateDelayMs);
      }
      for (const listener of listeners) {
        listener();
      }
      return finalResponse;
    },
    cancel: jest.fn(),
    getResponse: () => response,
    isGenerating: () => false,
    isReady: () => true,
    getGeneratedTokenCount: () => tokenCount,
    getPromptTokenCount: () => 10,
    getTotalTokenCount: () => 10 + tokenCount,
    getMessageHistoryLength: () => messageHistoryLength,
    clearHistory: (): void => {
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
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) {
      return;
    }
    await flushPromises();
    await sleep(0);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withImagePath(imagePath: string): InferenceRequest {
  return { ...firstRequest, imagePath };
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}
