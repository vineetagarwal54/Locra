jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { createCanonicalConversationContext } from '../../src/inference/ContextBuilder';
import type { PreprocessedImage } from '../../src/inference/ImagePreprocessor';
import {
  InferenceQueue,
  type InferenceEngineAdapter,
  type InferenceQueueDeps,
} from '../../src/inference/InferenceQueue';
import { CONTEXT_MODES, type UserFacingAnswerRequest } from '../../src/inference/OutputPipelineTypes';
import type { InferenceRequest } from '../../src/types/models';

const request: InferenceRequest = {
  imagePath: '/camera/capture.jpg',
  question: 'What should I do?',
};
const extractionJson = JSON.stringify({
  subjectObject: 'worn cooking pan',
  visibleFeatures: ['dark surface', 'scratched center'],
  visibleText: [],
  visibleCondition: 'worn in the center',
  uncertainty: ['coating material is unclear'],
});

function preprocess(imagePath: string): Promise<PreprocessedImage> {
  return Promise.resolve({ path: `${imagePath}.512`, width: 512, height: 384 });
}

function makeQueue(overrides: Partial<InferenceQueueDeps> = {}): InferenceQueue {
  const engine: InferenceEngineAdapter =
    overrides.engine ??
    {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken) => {
        const response = generateRequest.kind === 'extraction'
          ? extractionJson
          : 'A direct answer.';
        onToken(response, 4);
        return Promise.resolve({ response, tokenCount: 4 });
      },
    };

  return new InferenceQueue({
    preprocess,
    isReadyForInference: () => true,
    engine,
    ...overrides,
  });
}

describe('output pipeline contract', () => {
  it('normal image questions use one direct vision request', async () => {
    const seenRequests: unknown[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken) => {
        seenRequests.push(generateRequest);
        const response = 'A direct answer.';
        onToken(response, 4);
        return Promise.resolve({ response, tokenCount: 4 });
      },
    };
    const queue = makeQueue({ engine });

    await queue.submit(request);

    expect(seenRequests[0]).toMatchObject({
      kind: 'answer',
      originalQuestion: request.question,
      responseMode: 'Medium',
    });
    expect(seenRequests[0]).toHaveProperty(
      'messages',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          mediaPath: '/camera/capture.jpg.512',
        }),
      ])
    );
    expect(seenRequests).toHaveLength(1);
  });

  it('active follow-ups send explicit bounded canonical messages through the runtime path', async () => {
    const preprocessSpy = jest.fn(preprocess);
    const loadModel = jest.fn(() => Promise.resolve());
    const generate = jest.fn((_generateRequest, onToken) => {
      onToken('Follow-up answer.', 3);
      return Promise.resolve({ response: 'Follow-up answer.', tokenCount: 3 });
    });
    const queue = makeQueue({
      preprocess: preprocessSpy,
      engine: { loadModel, generate },
    });

    await queue.submit(request, {
      turn: 'followUp',
      conversationContext: createCanonicalConversationContext([
        {
          question: 'List the available repair paths.',
          answer: 'Replacement keeps the warranty. Repair is faster but voids it.',
        },
      ]),
    });

    expect(preprocessSpy).not.toHaveBeenCalled();
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      {
        messages: [
          expect.objectContaining({
            role: 'system',
            content: expect.stringMatching(/final user message is the current request/i),
          }),
          { role: 'user', content: 'List the available repair paths.' },
          {
            role: 'assistant',
            content: 'Replacement keeps the warranty. Repair is faster but voids it.',
          },
          { role: 'user', content: request.question },
        ],
        kind: 'chat',
        originalQuestion: request.question,
        responseMode: 'Medium',
      },
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('represents resumed context as a one-time answer request mode', () => {
    const resumedRequest: UserFacingAnswerRequest = {
      question: 'What about the handle?',
      conversationMode: 'resumeReconstruction',
      generationConfigId: 'qwen3-vl-2b-instruct-v1',
      pipelineVariantId: 'baseline-current',
    };

    expect(CONTEXT_MODES).toContain('resumeReconstruction');
    expect(CONTEXT_MODES).toContain('postReconstruction');
    expect(resumedRequest.conversationMode).toBe('resumeReconstruction');
  });

  it('keeps image preservation wired through the production preprocess boundary', () => {
    const queueSource = readFileSync(join(process.cwd(), 'src/inference/InferenceQueue.ts'), 'utf8');
    const enhancerSource = readFileSync(join(process.cwd(), 'src/inference/ImageEnhancer.ts'), 'utf8');

    expect(queueSource).toContain('prepareImageForInference');
    expect(enhancerSource).toContain('EnhanceOptions');
  });
});
