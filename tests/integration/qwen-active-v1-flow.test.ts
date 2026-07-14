import { createCanonicalConversationContext } from '../../src/inference/ContextBuilder';
import type { PreprocessedImage } from '../../src/inference/ImagePreprocessor';
import type {
  EngineGenerateRequest,
  EngineGenerateResult,
  InferenceEngineAdapter,
} from '../../src/inference/InferenceEngineHandle';
import { InferenceQueue } from '../../src/inference/InferenceQueue';

jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));

// After promotion, Qwen is the active V1 runtime selected by default at startup,
// and the full product flow (text streaming, image Q&A, follow-ups, cancellation,
// failures) runs through the runtime-neutral queue. This is the final automated
// gate before ExecuTorch deletion.

const extractionJson = JSON.stringify({
  subjectObject: 'a potted plant',
  visibleFeatures: ['green leaves', 'terracotta pot'],
  visibleText: [],
  visibleCondition: 'healthy',
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

describe('Qwen active V1 runtime flow', () => {
  it('answers an image question then a grounded follow-up through the neutral queue', async () => {
    const generated: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (request, onToken) => {
        generated.push(request);
        const response =
          request.kind === 'extraction'
            ? extractionJson
            : request.kind === 'chat'
              ? 'It is a healthy potted plant in a terracotta pot.'
              : 'A green potted plant.';
        onToken(response);
        return Promise.resolve<EngineGenerateResult>({ response, tokenCount: 6 });
      },
    };
    const queue = new InferenceQueue({ preprocess: makePreprocess(), isReadyForInference: () => true, engine });

    await queue.submit({ imagePath: '/camera/plant.jpg', question: 'What is this?' });
    expect(queue.getState().status).toBe('completed');
    expect(queue.getState().response).toBe('A green potted plant.');

    const context = createCanonicalConversationContext([
      { question: 'What is this?', answer: 'A green potted plant.' },
    ]);
    await queue.submit(
      { imagePath: '/camera/plant.jpg', question: 'What kind of pot?' },
      { turn: 'followUp', conversationContext: context }
    );
    expect(queue.getState().status).toBe('completed');
    expect(queue.getState().response).toContain('terracotta');
    expect(generated.map((r) => r.kind)).toEqual(['answer', 'chat']);
  });

  it('cancels an in-flight generation and returns to idle', async () => {
    const generateDeferred = defer<EngineGenerateResult>();
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: () => generateDeferred.promise,
    };
    const queue = new InferenceQueue({ preprocess: makePreprocess(), isReadyForInference: () => true, engine });

    const submitPromise = queue.submit({ imagePath: null, question: 'Tell me a story.' });
    await Promise.resolve();
    await Promise.resolve();
    queue.cancel();

    // Race-safe cancel: stays 'cancelling' until the native call settles.
    expect(queue.getState().status).toBe('cancelling');
    generateDeferred.resolve({ response: '', tokenCount: 0 });
    await submitPromise;
    expect(queue.getState().status).toBe('idle');
  });

  it('reports a failed generation as an errored state', async () => {
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: () => Promise.reject(new Error('load failure')),
    };
    const queue = new InferenceQueue({ preprocess: makePreprocess(), isReadyForInference: () => true, engine });

    await queue.submit({ imagePath: null, question: 'Hi.' });
    expect(queue.getState().status).toBe('errored');
    expect(queue.getState().error).toContain('load failure');
  });
});
