const mockProductionStorage = {
  set: jest.fn(),
  getString: jest.fn(),
  getAllKeys: jest.fn((): string[] => []),
  remove: jest.fn(() => false),
};

jest.mock('../../src/storage/mmkv', () => ({
  storage: mockProductionStorage,
}));
jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));

import { HistoryStore, type HistoryStorage } from '../../src/history/HistoryStore';
import type { PreprocessedImage } from '../../src/inference/ImagePreprocessor';
import {
  InferenceQueue,
  type EngineGenerateRequest,
  type InferenceEngineAdapter,
} from '../../src/inference/InferenceQueue';
import type { Conversation, InferenceRequest } from '../../src/types/models';

class MemoryHistoryStorage implements HistoryStorage {
  private readonly values = new Map<string, string | number | boolean | ArrayBuffer>();

  set(key: string, value: string | number | boolean | ArrayBuffer): void {
    this.values.set(key, value);
  }

  getString(key: string): string | undefined {
    const value = this.values.get(key);
    return typeof value === 'string' ? value : undefined;
  }

  getAllKeys(): string[] {
    return Array.from(this.values.keys());
  }

  remove(key: string): boolean {
    return this.values.delete(key);
  }
}

interface NetworkGlobal {
  XMLHttpRequest?: unknown;
  WebSocket?: unknown;
}

const capturedRequest: InferenceRequest = {
  imagePath: '/camera/raw-capture.jpg',
  question: 'What object is on the table?',
};
const extractionJson = JSON.stringify({
  subjectObject: 'coffee mug',
  visibleFeatures: ['white ceramic', 'on a table'],
  visibleText: [],
  visibleCondition: 'upright and intact',
  uncertainty: [],
});
const visibleAnswer = 'It looks like a white ceramic coffee mug on the table.';

function makePreprocess(): (imagePath: string) => Promise<PreprocessedImage> {
  return (imagePath) =>
    Promise.resolve({
      path: `${imagePath}.preprocessed`,
      width: 512,
      height: 384,
    });
}

describe('offline capture to answer integration flow', () => {
  const originalFetch = globalThis.fetch;
  const networkGlobal = globalThis as unknown as NetworkGlobal;
  const originalXMLHttpRequest = networkGlobal.XMLHttpRequest;
  const originalWebSocket = networkGlobal.WebSocket;

  let fetchSpy: jest.Mock;
  let xhrSpy: jest.Mock;
  let webSocketSpy: jest.Mock;

  beforeEach(() => {
    fetchSpy = jest.fn(() => Promise.reject(new Error('Network is blocked in airplane mode')));
    xhrSpy = jest.fn();
    webSocketSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    networkGlobal.XMLHttpRequest = xhrSpy;
    networkGlobal.WebSocket = webSocketSpy;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    networkGlobal.XMLHttpRequest = originalXMLHttpRequest;
    networkGlobal.WebSocket = originalWebSocket;
  });

  it('answers and persists a captured image request with zero network calls observed', async () => {
    const generatedRequests: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (request, onToken) => {
        generatedRequests.push(request);
        const response = request.kind === 'extraction' ? extractionJson : visibleAnswer;
        onToken(response);
        return Promise.resolve({ response, tokenCount: 7 });
      },
    };
    const queue = new InferenceQueue({
      preprocess: makePreprocess(),
      isReadyForInference: () => true,
      engine,
    });
    const history = new HistoryStore(new MemoryHistoryStorage());

    await queue.submit(capturedRequest);

    const state = queue.getState();
    expect(state.status).toBe('completed');
    expect(state.response).toBe(visibleAnswer);
    expect(generatedRequests[0]).toEqual(
      expect.objectContaining({
        kind: 'extraction',
        originalQuestion: capturedRequest.question,
      })
    );
    expect(generatedRequests[0].messages[1]).toEqual(
      expect.objectContaining({
        mediaPath: '/camera/raw-capture.jpg.preprocessed',
        content: expect.stringMatching(/subject\/object/i),
      })
    );
    expect(generatedRequests[0].messages[1].content).toContain(capturedRequest.question);
    expect(generatedRequests[1]).toEqual(
      expect.objectContaining({
        kind: 'answer',
        originalQuestion: capturedRequest.question,
      })
    );
    expect(generatedRequests[1].messages.some((message) => message.mediaPath)).toBe(false);
    expect(generatedRequests[1].messages.at(-1)?.content).toContain('Image evidence: coffee mug');

    const conversation: Conversation = {
      id: 'completed-flow',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_001,
      messages: [
        {
          id: 'completed-flow:user',
          role: 'user',
          text: capturedRequest.question,
          attachments:
            capturedRequest.imagePath === null
              ? []
              : [{ kind: 'image', path: capturedRequest.imagePath }],
          status: 'completed',
          errorMessage: null,
          createdAt: 1_700_000_000_000,
        },
        {
          id: 'completed-flow:assistant',
          role: 'assistant',
          text: state.response,
          attachments: [],
          status: 'completed',
          errorMessage: null,
          createdAt: 1_700_000_000_001,
        },
      ],
      status: 'completed',
      errorMessage: null,
      metrics: state.metrics,
      flagged: false,
      flagNote: null,
    };
    history.save(conversation);

    expect(history.list()).toEqual([conversation]);
    expect(conversation.messages[1]?.text).toBe(visibleAnswer);
    expect(state.hiddenEvidence?.subjectObject).toBe('coffee mug');
    expect('hiddenEvidence' in conversation).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(webSocketSpy).not.toHaveBeenCalled();
  });
});
