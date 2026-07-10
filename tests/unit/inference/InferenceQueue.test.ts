// InferenceQueue transitively imports ImagePreprocessor, which pulls in the
// native react-native-nitro-image module at require time. Stub it out — this
// suite injects its own preprocess and never touches the real backend.
jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { OUTPUT_TOKEN_BUDGET } from '../../../src/inference/GenerationTuning';
import type { PreprocessedImage } from '../../../src/inference/ImagePreprocessor';
import { InferenceMetricsRecorder } from '../../../src/inference/InferenceMetrics';
import {
  InferenceQueue,
  type EngineGenerateRequest,
  type InferenceEngineAdapter,
  type InferenceQueueDeps,
} from '../../../src/inference/InferenceQueue';
import type { InferenceRequest, InferenceState } from '../../../src/types/models';

// Let all pending microtasks (the awaited preprocess/loadModel steps) settle.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeClock(): { advanceTo: (time: number) => void; now: () => number } {
  let current = 0;
  return {
    advanceTo: (time: number): void => {
      current = time;
    },
    now: (): number => current,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const request: InferenceRequest = { imagePath: '/tmp/capture.jpg', question: 'What is this?' };
const validExtractionJson = JSON.stringify({
  subjectObject: 'ceramic mug',
  visibleFeatures: ['blue glaze', 'chipped handle'],
  visibleText: [],
  visibleCondition: 'clean with a chipped handle',
  uncertainty: ['exact size is unclear from the image'],
});

function passthroughPreprocess(imagePath: string): Promise<PreprocessedImage> {
  return Promise.resolve({ path: imagePath, width: 512, height: 512 });
}

function makeQueue(overrides: Partial<InferenceQueueDeps> = {}): InferenceQueue {
  const deps: InferenceQueueDeps = {
    preprocess: passthroughPreprocess,
    isReadyForInference: () => true,
    engine: overrides.engine ?? twoStageEngine('answer', 3),
    ...overrides,
  };
  return new InferenceQueue(deps);
}

function twoStageEngine(answer: string, tokenCount: number): InferenceEngineAdapter {
  let calls = 0;
  return {
    loadModel: () => Promise.resolve(),
    generate: (_req, onToken) => {
      calls += 1;
      const response = calls === 1 ? validExtractionJson : answer;
      onToken(response);
      return Promise.resolve({ response, tokenCount });
    },
  };
}

describe('InferenceQueue', () => {
  it('completes a request and populates all five metrics', async () => {
    const queue = makeQueue();
    await queue.submit(request);

    const state = queue.getState();
    expect(state.status).toBe('completed');
    expect(state.response).toBe('answer');
    expect(state.metrics).not.toBeNull();
    expect(Object.keys(state.metrics ?? {})).toEqual(
      expect.arrayContaining([
        'modelLoadTimeMs',
        'preprocessingTimeMs',
        'firstTokenLatencyMs',
        'tokensPerSecond',
        'totalWallTimeMs',
      ]),
    );
  });

  it('rejects submit() while a request is in-flight without acquiring the lock (FR-006)', async () => {
    const gate = deferred<{ response: string; tokenCount: number }>();
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (_req, onToken) => {
        onToken('do'); // a first token streams, then generation stays in flight
        return gate.promise;
      },
    };
    const queue = makeQueue({ engine });

    const first = queue.submit(request);
    await flush(); // drive the first request into 'streaming'
    expect(queue.getState().status).toBe('streaming');

    const before = queue.getState();
    await expect(queue.submit(request)).rejects.toThrow();
    // The rejected second call must not have disturbed the in-flight state.
    expect(queue.getState()).toEqual(before);

    gate.resolve({ response: 'done', tokenCount: 1 });
    await first;
    expect(queue.getState().status).toBe('completed');
  });

  it('cancel() discards the partial response, returns to idle, and leaves no residual output (FR-007)', async () => {
    const gate = deferred<{ response: string; tokenCount: number }>();
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (_req, onToken) => {
        onToken('partial ans');
        return gate.promise;
      },
    };
    const seen: InferenceState[] = [];
    const queue = makeQueue({ engine });
    queue.subscribe((s) => seen.push({ ...s }));

    const inFlight = queue.submit(request, { turn: 'followUp' });
    await flush();
    expect(queue.getState().response).toBe('partial ans');

    queue.cancel();

    // Subscribers observe the terminal 'cancelled' notification (contract)...
    expect(seen.some((s) => s.status === 'cancelled')).toBe(true);
    // ...and the queue returns to idle with no residual output.
    const state = queue.getState();
    expect(state.status).toBe('idle');
    expect(state.response).toBe('');
    expect(state.metrics).toBeNull();

    // A late resolution of the cancelled generation must not resurrect output.
    gate.resolve({ response: 'partial ans and more', tokenCount: 9 });
    await inFlight;
    expect(queue.getState().response).toBe('');
    expect(queue.getState().status).toBe('idle');
  });

  it('resolves an injected OOM error during streaming to status errored, never an unhandled throw (FR-023)', async () => {
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: () => Promise.reject(new Error('Cannot allocate tensor: out of memory')),
    };
    const queue = makeQueue({ engine });

    await expect(queue.submit(request)).resolves.toBeUndefined();

    const state = queue.getState();
    expect(state.status).toBe('errored');
    expect(state.error).toMatch(/out of memory/i);
  });

  it('releases the lock on the completed exit path', async () => {
    const queue = makeQueue();
    await queue.submit(request);
    expect(queue.getState().status).toBe('completed');
    // Lock released → a fresh submit is accepted, not rejected by single-flight.
    await expect(queue.submit(request)).resolves.toBeUndefined();
    expect(queue.getState().status).toBe('completed');
  });

  it('releases the lock on the cancelled exit path', async () => {
    const gate = deferred<{ response: string; tokenCount: number }>();
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: () => gate.promise,
    };
    const queue = makeQueue({ engine });

    const inFlight = queue.submit(request);
    await flush();
    queue.cancel();
    gate.resolve({ response: 'x', tokenCount: 1 });
    await inFlight;

    await expect(queue.submit(request)).resolves.toBeUndefined();
  });

  it('releases the lock on the errored exit path', async () => {
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: () => Promise.reject(new Error('out of memory')),
    };
    const queue = makeQueue({ engine });

    await queue.submit(request);
    expect(queue.getState().status).toBe('errored');
    await expect(queue.submit(request)).resolves.toBeUndefined();
  });
});

describe('InferenceQueue two-stage first image turns', () => {
  it('constructs a hidden perception request followed by a text-only answer request', async () => {
    const generatedRequests: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken) => {
        generatedRequests.push(generateRequest);
        const response = generatedRequests.length === 1
          ? validExtractionJson
          : 'It is a ceramic mug with a chipped handle.';
        onToken(response, 8);
        return Promise.resolve({ response, tokenCount: 8 });
      },
    };
    const queue = makeQueue({ engine });

    await queue.submit(request);

    expect(generatedRequests).toHaveLength(2);
    expect(generatedRequests[0]).toMatchObject({
      kind: 'extraction',
      originalQuestion: request.question,
    });
    expect(generatedRequests[0].messages[1]).toEqual(
      expect.objectContaining({
        role: 'user',
        mediaPath: request.imagePath,
        content: expect.stringMatching(/valid json only/i),
      })
    );
    expect(generatedRequests[1]).toMatchObject({
      kind: 'answer',
      originalQuestion: request.question,
    });
    expect(generatedRequests[1].messages.some((message) => message.mediaPath)).toBe(false);
    expect(generatedRequests[1].messages.at(-1)?.content).toContain('Image evidence: ceramic mug');
    expect(generatedRequests[1].messages.at(-1)?.content).toContain(request.question);
  });

  it('runs the image pipeline for an attributed image-bearing follow-up with prior context', async () => {
    const generatedRequests: EngineGenerateRequest[] = [];
    const followUpRequest: InferenceRequest = {
      requestId: 'request-follow-up-image',
      conversationId: 'conversation-1',
      originatingUserMessageId: 'user-message-2',
      assistantMessageId: 'assistant-message-2',
      imagePath: '/tmp/follow-up.jpg',
      question: 'Compare this new image.',
    };
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken) => {
        generatedRequests.push(generateRequest);
        const response = generatedRequests.length === 1
          ? validExtractionJson
          : 'The new image is another ceramic item.';
        onToken(response, 8);
        return Promise.resolve({ response, tokenCount: 8 });
      },
    };
    const queue = makeQueue({ engine });

    await queue.submit(followUpRequest, {
      turn: 'followUp',
      canonicalTurns: [
        { question: 'What was image A?', answer: 'Image A showed a metal pan.' },
      ],
    });

    expect(generatedRequests.map((item) => item.kind)).toEqual(['extraction', 'answer']);
    expect(generatedRequests[0].messages[1]).toEqual(
      expect.objectContaining({ mediaPath: '/tmp/follow-up.jpg' }),
    );
    expect(generatedRequests[1].messages.some((message) => message.mediaPath)).toBe(false);
    expect(generatedRequests[1].messages.map((message) => message.content)).toEqual(
      expect.arrayContaining([
        'What was image A?',
        'Image A showed a metal pan.',
      ]),
    );
    expect(generatedRequests[1].messages.at(-1)?.content).toContain('Image evidence: ceramic mug');
    expect(queue.getState().status).toBe('completed');
  });

  it('records a dev-only trace without treating internal stages as visible chat', async () => {
    const queue = makeQueue({ isTraceEnabled: () => true });

    await queue.submit(request);

    const trace = queue.getState().inferenceTrace;
    expect(trace?.stages.map((stage) => stage.stage)).toEqual(['perception', 'answer']);
    expect(trace?.stages[0].modelInput[1]).toEqual(
      expect.objectContaining({ mediaPath: request.imagePath })
    );
    expect(trace?.stages[0].rawOutput).toBe(validExtractionJson);
    expect(trace?.stages[0].parsedOutput).toEqual(
      expect.objectContaining({ subjectObject: 'ceramic mug' })
    );
    expect(trace?.finalResponse).toBe('answer');
    expect(queue.getState().response).toBe('answer');
  });

  it('exposes a completed production-owned objective result record', async () => {
    const clock = makeClock();
    const generatedRequests: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => {
        clock.advanceTo(50);
        return Promise.resolve();
      },
      generate: (generateRequest, onToken) => {
        generatedRequests.push(generateRequest);
        if (generateRequest.kind === 'extraction') {
          clock.advanceTo(200);
          return Promise.resolve({ response: validExtractionJson, tokenCount: 14, promptTokenCount: 30 });
        }
        clock.advanceTo(325);
        onToken('The mug handle is chipped.', 6);
        clock.advanceTo(700);
        return Promise.resolve({
          response: 'The mug handle is chipped.',
          tokenCount: 6,
          promptTokenCount: 44,
        });
      },
    };
    const queue = makeQueue({
      createRecorder: () => new InferenceMetricsRecorder(clock.now),
      engine,
      getDeviceBuildMetadata: () => ({
        deviceNameModel: 'Pixel 8 Pro',
        appBuildId: 'locra-test-build',
      }),
    });

    clock.advanceTo(0);
    await queue.submit(request);

    const record = queue.getState().objectiveResult;
    expect(record).toEqual(
      expect.objectContaining({
        answerText: 'The mug handle is chipped.',
        perceptionLatencyMs: 150,
        answerTtftMs: 125,
        answerGenerationLatencyMs: 500,
        totalEndToEndLatencyMs: 700,
        generatedTokens: 6,
        promptTokens: 44,
        modelId: 'LFM2_5_VL_1_6B_QUANTIZED',
        generationConfigId: 'recommended-lfm2-vl-v1',
        pipelineVariantId: 'recommended-sampling-v1',
        deviceNameModel: 'Pixel 8 Pro',
        appBuildId: 'locra-test-build',
        truncated: false,
        looping: false,
      }),
    );
    expect(record?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(generatedRequests.map((item) => item.kind)).toEqual(['extraction', 'answer']);
  });

  it('never exposes raw structured extraction as the completed visible answer', async () => {
    const queue = makeQueue();

    await queue.submit(request);

    const state = queue.getState();
    expect(state.status).toBe('completed');
    expect(state.response).toBe('answer');
    expect(state.response).not.toMatch(/subjectObject|visibleFeatures|Subject\/object/i);
    expect(state.pinnedExtraction).toContain('Subject/object: ceramic mug');
    expect(state.hiddenEvidence?.subjectObject).toBe('ceramic mug');
  });

  it('uses a safe fallback and releases the lock after perception parse failure', async () => {
    const generatedRequests: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken) => {
        generatedRequests.push(generateRequest);
        const response = generatedRequests.length === 1
          ? 'not json from perception'
          : 'still not json from retry';
        onToken(response, 4);
        return Promise.resolve({ response, tokenCount: 4 });
      },
    };
    const queue = makeQueue({ engine });

    await queue.submit(request);

    expect(queue.getState().status).toBe('completed');
    expect(queue.getState().response).toMatch(/couldn't extract reliable visual evidence/i);
    expect(queue.getState().response).not.toContain('not json from perception');
    expect(queue.getState().pinnedExtraction).toMatch(/visual evidence unavailable/i);
    await expect(queue.submit(request)).resolves.toBeUndefined();
  });

  it('cancels cleanly during hidden perception without starting answer generation', async () => {
    const gate = deferred<{ response: string; tokenCount: number }>();
    const generatedRequests: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest) => {
        generatedRequests.push(generateRequest);
        return gate.promise;
      },
    };
    const queue = makeQueue({ engine });

    const inFlight = queue.submit(request);
    await flush();
    queue.cancel();
    gate.resolve({ response: validExtractionJson, tokenCount: 8 });
    await inFlight;

    expect(generatedRequests).toHaveLength(1);
    expect(queue.getState().status).toBe('idle');
    expect(queue.getState().response).toBe('');
    expect(queue.getState().pinnedExtraction).toBeNull();
  });
});

describe('InferenceQueue output-length cap (FR-052)', () => {
  // Advance the simulated token count in batches (like a real token batch) so
  // the cap trips in a few ticks regardless of how large OUTPUT_TOKEN_BUDGET is
  // tuned — the test stays fast and budget-agnostic.
  const TOKENS_PER_TICK = 16;

  it('aborts generation once the token budget is reached and still resolves completed', async () => {
    // Engine that streams a batch of tokens per tick forever unless it aborts.
    let streamedTokens = 0;
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken, signal) => {
        if (generateRequest.kind === 'extraction') {
          onToken(validExtractionJson, 4);
          return Promise.resolve({ response: validExtractionJson, tokenCount: 4 });
        }
        return new Promise((resolve) => {
          const interval = setInterval(() => {
            streamedTokens += TOKENS_PER_TICK;
            onToken(`streamed ${streamedTokens} tokens`, streamedTokens);
          }, 1);
          signal.addEventListener('abort', () => {
            clearInterval(interval);
            // Contract: on abort, generate resolves with the partial response.
            resolve({
              response: `streamed ${streamedTokens} tokens`,
              tokenCount: streamedTokens,
            });
          });
        });
      },
    };
    const queue = makeQueue({ engine });

    await queue.submit(request);

    const state = queue.getState();
    expect(state.status).toBe('completed');
    // Stopped near the budget, not run unbounded.
    expect(streamedTokens).toBeGreaterThanOrEqual(OUTPUT_TOKEN_BUDGET);
    expect(streamedTokens).toBeLessThan(OUTPUT_TOKEN_BUDGET + TOKENS_PER_TICK * 3);
    expect(state.response).not.toBe('');
    expect(state.limitWarning).toMatch(/length limit/i);
  });

  it('does not abort or warn when generation finishes under the budget', async () => {
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken) => {
        const response = generateRequest.kind === 'extraction' ? validExtractionJson : 'short answer.';
        onToken(response, 3);
        return Promise.resolve({ response, tokenCount: 3 });
      },
    };
    const queue = makeQueue({ engine });

    await queue.submit(request);

    const state = queue.getState();
    expect(state.status).toBe('completed');
    expect(state.limitWarning).toBeNull();
  });

  it('a budget stop is not a user cancel — the completed answer is persisted-eligible', async () => {
    const seen: InferenceState[] = [];
    let streamedTokens = 0;
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken, signal) => {
        if (generateRequest.kind === 'extraction') {
          onToken(validExtractionJson, 4);
          return Promise.resolve({ response: validExtractionJson, tokenCount: 4 });
        }
        return new Promise((resolve) => {
          const interval = setInterval(() => {
            streamedTokens += TOKENS_PER_TICK;
            onToken(`streamed ${streamedTokens} tokens`, streamedTokens);
          }, 1);
          signal.addEventListener('abort', () => {
            clearInterval(interval);
            resolve({ response: `streamed ${streamedTokens} tokens`, tokenCount: streamedTokens });
          });
        });
      },
    };
    const queue = makeQueue({ engine });
    queue.subscribe((s) => seen.push({ ...s }));

    await queue.submit(request);

    expect(seen.some((s) => s.status === 'cancelled')).toBe(false);
    expect(queue.getState().status).toBe('completed');
    expect(queue.getState().metrics).not.toBeNull();
  });
});

describe('InferenceQueue post-processing (FR-054)', () => {
  it('trims the completed response and flags a truncated tail via the limit notice', async () => {
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken) => {
        const raw = generateRequest.kind === 'extraction'
          ? validExtractionJson
          : '  The mug is blue and the  ';
        onToken(raw, 6);
        return Promise.resolve({ response: raw, tokenCount: 6 });
      },
    };
    const queue = makeQueue({ engine });

    await queue.submit(request);

    const state = queue.getState();
    expect(state.status).toBe('completed');
    expect(state.response).toBe('The mug is blue and the');
    expect(state.limitWarning).toMatch(/cut off/i);
  });

  it('collapses a looping tail and flags it', async () => {
    const looping = 'It is a red bicycle. It is a red bicycle. It is a red bicycle.';
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken) => {
        const response = generateRequest.kind === 'extraction' ? validExtractionJson : looping;
        onToken(response, 24);
        return Promise.resolve({ response, tokenCount: 24 });
      },
    };
    const queue = makeQueue({ engine });

    await queue.submit(request);

    const state = queue.getState();
    expect(state.response).toBe('It is a red bicycle.');
    expect(state.limitWarning).toMatch(/repeat/i);
  });
});

describe('InferenceQueue default wiring (FR-049)', () => {
  it('createInferenceQueue defaults preprocess to the enhance→ceiling pipeline', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/InferenceQueue.ts'),
      'utf8'
    );
    expect(source).toContain('prepareImageForInference');
    expect(source).toMatch(/preprocess:\s*prepareImageForInference/);
  });
});
