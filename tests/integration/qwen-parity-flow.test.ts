import { createCanonicalConversationContext } from '../../src/inference/ContextBuilder';
import type { PreprocessedImage } from '../../src/inference/ImagePreprocessor';
import type {
  EngineGenerateRequest,
  EngineGenerateResult,
  InferenceEngineAdapter,
} from '../../src/inference/InferenceEngineHandle';
import { InferenceQueue } from '../../src/inference/InferenceQueue';

jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));

// Automated Qwen parity: text streaming, image Q&A, follow-ups, cancellation, and
// failure recovery all flow through the runtime-neutral queue with a Qwen-like
// adapter. (Physical-device throughput/latency parity is validated separately in
// quickstart.md, T038–T040.)

const extractionJson = JSON.stringify({
  subjectObject: 'a red apple',
  visibleFeatures: ['round', 'shiny'],
  visibleText: [],
  visibleCondition: 'fresh',
  uncertainty: [],
});

function makePreprocess(): (imagePath: string) => Promise<PreprocessedImage> {
  return (imagePath) => Promise.resolve({ path: `${imagePath}.pre`, width: 512, height: 384 });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('Qwen parity flow (runtime-neutral)', () => {
  it('streams a text-only answer to completion', async () => {
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (_request, onToken) => {
        onToken('The');
        onToken('The answer');
        return Promise.resolve<EngineGenerateResult>({ response: 'The answer', tokenCount: 2 });
      },
    };
    const queue = new InferenceQueue({ preprocess: makePreprocess(), isReadyForInference: () => true, engine });

    await queue.submit({ imagePath: null, question: 'Tell me something.' });

    expect(queue.getState().status).toBe('completed');
    expect(queue.getState().response).toBe('The answer');
  });

  it('answers a normal image question with one direct vision call', async () => {
    const generated: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (request, onToken) => {
        generated.push(request);
        const response = request.kind === 'extraction' ? extractionJson : 'A shiny red apple.';
        onToken(response);
        return Promise.resolve<EngineGenerateResult>({ response, tokenCount: 4 });
      },
    };
    const queue = new InferenceQueue({ preprocess: makePreprocess(), isReadyForInference: () => true, engine });

    await queue.submit({ imagePath: '/camera/apple.jpg', question: 'What is this?' });

    expect(queue.getState().status).toBe('completed');
    expect(queue.getState().response).toBe('A shiny red apple.');
    expect(generated.map((r) => r.kind)).toEqual(['answer']);
  });

  it('uses supplied conversation context as authority for a follow-up turn', async () => {
    let followUpRequest: EngineGenerateRequest | null = null;
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (request, onToken) => {
        followUpRequest = request;
        onToken('It is a Granny Smith.');
        return Promise.resolve<EngineGenerateResult>({ response: 'It is a Granny Smith.', tokenCount: 5 });
      },
    };
    const queue = new InferenceQueue({ preprocess: makePreprocess(), isReadyForInference: () => true, engine });

    const context = createCanonicalConversationContext([
      { question: 'What is this?', answer: 'A shiny red apple.' },
    ]);
    await queue.submit(
      { imagePath: '/camera/apple.jpg', question: 'What variety?' },
      { turn: 'followUp', conversationContext: context }
    );

    expect(queue.getState().status).toBe('completed');
    expect(followUpRequest).not.toBeNull();
    expect(followUpRequest!.kind).toBe('chat');
    // The prior turn is carried as authoritative supplied context.
    const joined = followUpRequest!.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('A shiny red apple.');
  });

  it('cancels a running generation and returns to idle', async () => {
    const generateDeferred = defer<EngineGenerateResult>();
    let signal: AbortSignal | null = null;
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (_request, _onToken, abortSignal) => {
        signal = abortSignal;
        return generateDeferred.promise;
      },
    };
    const queue = new InferenceQueue({ preprocess: makePreprocess(), isReadyForInference: () => true, engine });

    const submitPromise = queue.submit({ imagePath: null, question: 'Long answer please.' });
    await Promise.resolve();
    await Promise.resolve();
    queue.cancel();

    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(queue.getState().status).toBe('idle');
    generateDeferred.resolve({ response: '', tokenCount: 0 });
    await submitPromise;
  });

  it('recovers to a working turn after a failed generation', async () => {
    let shouldFail = true;
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (_request, onToken) => {
        if (shouldFail) {
          return Promise.reject(new Error('native failure'));
        }
        onToken('Recovered answer.');
        return Promise.resolve<EngineGenerateResult>({ response: 'Recovered answer.', tokenCount: 2 });
      },
    };
    const queue = new InferenceQueue({ preprocess: makePreprocess(), isReadyForInference: () => true, engine });

    await queue.submit({ imagePath: null, question: 'First.' });
    expect(queue.getState().status).toBe('errored');

    shouldFail = false;
    await queue.submit({ imagePath: null, question: 'Second.' });
    expect(queue.getState().status).toBe('completed');
    expect(queue.getState().response).toBe('Recovered answer.');
  });
});
