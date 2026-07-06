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
    const generatedRequests: Array<{ question: string; imagePath?: string }> = [];
    const engine: InferenceEngineAdapter = {
      loadModel: jest.fn(() => Promise.resolve()),
      generate: (request, onToken) => {
        generatedRequests.push(request);
        const response = generatedRequests.length === 1 ? 'A notebook.' : 'It is black.';
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

    expect(generatedRequests).toEqual([
      {
        imagePath: '/camera/original.jpg.preprocessed',
        question: firstRequest.question,
      },
      {
        question: followUpRequest.question,
      },
    ]);
  });

  it('uses useLLM managed messageHistory for follow-up context instead of manual history or a new load', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/useInferenceEngine.ts'),
      'utf8'
    );

    expect(source).toContain('messageHistory');
    expect(source).toContain('SlidingWindowContextStrategy');
    expect(source).toContain('RESPONSE_TOKEN_BUDGET');
    expect(source).toMatch(/sendMessage\(prompt\)/);
    expect(source).toMatch(/sendMessage\(prompt,\s*\{\s*imagePath\s*\}\)/);
    expect(source).not.toMatch(/\.generate\(/);
    expect(countMatches(source, /\buseLLM\(/g)).toBe(1);
    expect(RESPONSE_TOKEN_BUDGET).toBeGreaterThan(512);
  });

  it('persists the full turns array as one history entry under the first session id', async () => {
    const engine = makeEngineHandle();

    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore.getState().submit(firstRequest);
    await useInferenceStore.getState().submit(followUpRequest);

    const savedSessions = historyStoreMock.mockSavedSessions as QASession[];
    expect(historyStoreMock.mockSave).toHaveBeenCalledTimes(2);
    expect(savedSessions).toHaveLength(2);
    expect(savedSessions[1].id).toBe(savedSessions[0].id);
    expect(savedSessions[1].turns).toEqual([
      { question: firstRequest.question, answer: 'A notebook.' },
      { question: followUpRequest.question, answer: 'It is black.' },
    ]);
    expect(engine.submissions).toEqual([
      { imagePath: '/camera/original.jpg', prompt: firstRequest.question, historyLengthBefore: 0 },
      { imagePath: null, prompt: followUpRequest.question, historyLengthBefore: 2 },
    ]);
  });

  it('persists the resolved final response even when streamed hook state is behind', async () => {
    const isolatedRequest: InferenceRequest = {
      ...firstRequest,
      imagePath: '/camera/second-original.jpg',
    };
    const engine = makeEngineHandle({
      firstStreamedResponse: 'A notebook with',
      firstFinalResponse: 'A notebook with a black cover.',
    });

    useInferenceStore.getState().registerEngine(engine);

    await useInferenceStore.getState().submit(isolatedRequest);

    const savedSessions = historyStoreMock.mockSavedSessions as QASession[];
    expect(savedSessions[0].answer).toBe('A notebook with a black cover.');
    expect(savedSessions[0].turns).toEqual([
      { question: isolatedRequest.question, answer: 'A notebook with a black cover.' },
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
      const finalResponse =
        prompt === firstRequest.question
          ? options.firstFinalResponse ?? 'A notebook.'
          : 'It is black.';
      response =
        prompt === firstRequest.question
          ? options.firstStreamedResponse ?? finalResponse
          : finalResponse;
      tokenCount = finalResponse.split(' ').length;
      messageHistoryLength += 2;
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
    getError: () => null,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}
