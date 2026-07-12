import { readFileSync } from 'fs';
import { join } from 'path';

import type { PreprocessedImage } from '../../src/inference/ImagePreprocessor';
import type {
  EngineGenerateRequest,
  InferenceEngineAdapter,
} from '../../src/inference/InferenceEngineHandle';
import { InferenceQueue } from '../../src/inference/InferenceQueue';
import type { InferenceRequest } from '../../src/types/models';

jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));

// Qwen reuses Locra's existing two-stage vision pipeline (perception extraction →
// grounded answer) unchanged, driven entirely through the runtime-neutral queue.
// The Qwen runtime must NOT touch ImagePreprocessor/ImageEnhancer.

const IMAGE_REQUEST: InferenceRequest = {
  imagePath: '/camera/capture.jpg',
  question: 'What is on the desk?',
};
const extractionJson = JSON.stringify({
  subjectObject: 'a notebook',
  visibleFeatures: ['spiral bound', 'blue cover'],
  visibleText: [],
  visibleCondition: 'closed',
  uncertainty: [],
});
const visibleAnswer = 'A blue spiral notebook is on the desk.';

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('Qwen uses the existing two-stage vision pipeline', () => {
  it('runs perception then grounded answer through the neutral queue with a single 512px preprocess', async () => {
    const preprocess = jest.fn(
      (imagePath: string): Promise<PreprocessedImage> =>
        Promise.resolve({ path: `${imagePath}.pre`, width: 512, height: 384 })
    );
    const generated: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (request, onToken) => {
        generated.push(request);
        const response = request.kind === 'extraction' ? extractionJson : visibleAnswer;
        onToken(response);
        return Promise.resolve({ response, tokenCount: 5 });
      },
    };
    const queue = new InferenceQueue({
      preprocess,
      isReadyForInference: () => true,
      engine,
    });

    await queue.submit(IMAGE_REQUEST);

    expect(queue.getState().status).toBe('completed');
    expect(queue.getState().response).toBe(visibleAnswer);
    // Exactly one preprocess (no duplicate image work), and it feeds the 512px
    // processed file into the perception stage.
    expect(preprocess).toHaveBeenCalledTimes(1);
    expect(generated[0].kind).toBe('answer');
    expect(generated[0].messages.at(-1)?.mediaPath).toBe('/camera/capture.jpg.pre');
    // Second stage is the grounded answer with no re-attached image.
    expect(generated).toHaveLength(1);
  });

  it('keeps the Qwen runtime free of ImagePreprocessor/ImageEnhancer imports', () => {
    const qwenSources = [
      'src/inference/llamaRn/QwenLlamaRuntime.ts',
      'src/inference/llamaRn/QwenMessageConverter.ts',
      'src/inference/llamaRn/QwenRuntimeConfig.ts',
      'src/inference/llamaRn/useQwenInferenceEngine.ts',
    ].map(readSource).join('\n');

    expect(qwenSources).not.toContain('ImagePreprocessor');
    expect(qwenSources).not.toContain('ImageEnhancer');
  });

  it('leaves the image preprocessing modules uncoupled from the Qwen runtime', () => {
    const preprocessorSource = readSource('src/inference/ImagePreprocessor.ts');
    const enhancerSource = readSource('src/inference/ImageEnhancer.ts');

    for (const source of [preprocessorSource, enhancerSource]) {
      expect(source).not.toMatch(/llama\.rn|llamaRn|Qwen/);
    }
  });
});
