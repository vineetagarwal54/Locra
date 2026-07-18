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

import { createCanonicalConversationContext } from '../../../src/inference/ContextBuilder';
import type { PreprocessedImage } from '../../../src/inference/ImagePreprocessor';
import { InferenceMetricsRecorder } from '../../../src/inference/InferenceMetrics';
import {
  InferenceQueue,
  type EngineGenerateRequest,
  type InferenceEngineAdapter,
  type InferenceQueueDeps,
} from '../../../src/inference/InferenceQueue';
import { getResponseTokenBudget } from '../../../src/inference/ResponseMode';
import type {
  CanonicalConversationContext,
  InferenceRequest,
  InferenceState,
} from '../../../src/types/models';

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

const request: InferenceRequest = {
  imagePath: '/tmp/capture.jpg',
  question: 'Read the text on this form.',
};
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
    getModelAttribution: () => ({
      modelId: 'GEMMA4_E2B_MM',
      generationConfigId: 'gemma4-e2b-mm-library-default',
    }),
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

  it('cleans a temporary prepared image after the native turn settles', async () => {
    const cleanupProcessedImage = jest.fn(async () => undefined);
    const queue = makeQueue({
      preprocess: async () => ({ path: '/cache/derived.jpg', width: 512, height: 512 }),
      cleanupProcessedImage,
    });

    await queue.submit(request);

    expect(cleanupProcessedImage).toHaveBeenCalledWith('/cache/derived.jpg', '/tmp/capture.jpg');
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

    const inFlight = queue.submit(request, {
      turn: 'followUp',
      conversationContext: createCanonicalConversationContext([]),
    });
    await flush();
    expect(queue.getState().response).toBe('partial ans');

    queue.cancel();

    // Race-safe cancel: the queue stays in-flight ('cancelling') and clears the
    // partial output immediately, but only settles to idle once the native call
    // returns (below).
    expect(queue.getState().status).toBe('cancelling');
    expect(queue.getState().response).toBe('');

    // A late resolution of the cancelled generation must not resurrect output.
    gate.resolve({ response: 'partial ans and more', tokenCount: 9 });
    await inFlight;

    // Subscribers observe the terminal 'cancelled' notification (contract)...
    expect(seen.some((s) => s.status === 'cancelled')).toBe(true);
    // ...and the queue returns to idle with no residual output.
    const state = queue.getState();
    expect(state.status).toBe('idle');
    expect(state.response).toBe('');
    expect(state.metrics).toBeNull();
  });

  it('rejects a follow-up before inference when canonical context is omitted', async () => {
    const generate = jest.fn(() => Promise.resolve({ response: 'unused', tokenCount: 1 }));
    const queue = makeQueue({
      engine: { loadModel: () => Promise.resolve(), generate },
    });

    await expect(queue.submit(request, { turn: 'followUp' })).rejects.toThrow(
      /requires canonical conversation context/i,
    );

    expect(generate).not.toHaveBeenCalled();
    expect(queue.getState().status).toBe('idle');
  });

  it('resolves an injected OOM error during streaming to status errored, never an unhandled throw (FR-023)', async () => {
    const generate = jest.fn(() =>
      Promise.reject(new Error('Cannot allocate tensor: out of memory'))
    );
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate,
    };
    const queue = makeQueue({ engine });

    await expect(queue.submit(request)).resolves.toBeUndefined();

    const state = queue.getState();
    expect(state.status).toBe('errored');
    expect(state.error).toMatch(/out of memory/i);
    expect(generate).toHaveBeenCalledTimes(1);
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

describe('InferenceQueue false tool-refusal recovery', () => {
  const textRequest: InferenceRequest = {
    imagePath: null,
    question: 'What is 17 times 24?',
  };

  it.each([
    { label: 'a first text-only question', imagePath: null, turn: 'first' as const },
    { label: 'a text-only follow-up', imagePath: null, turn: 'followUp' as const },
    { label: 'an image final answer', imagePath: '/tmp/math.jpg', turn: 'first' as const },
  ])('retries one false refusal for $label using the original context', async (scenario) => {
    const generatedRequests: EngineGenerateRequest[] = [];
    let visibleAttempts = 0;
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken) => {
        generatedRequests.push(generateRequest);
        if (generateRequest.kind === 'extraction') {
          return Promise.resolve({ response: validExtractionJson, tokenCount: 4 });
        }

        visibleAttempts += 1;
        const response = visibleAttempts === 1
          ? "I don't have the tool needed to calculate that."
          : '17 times 24 is 408.';
        onToken(response, 6);
        return Promise.resolve({ response, tokenCount: 6 });
      },
    };
    const queue = makeQueue({ engine });
    const scenarioRequest = { ...textRequest, imagePath: scenario.imagePath };
    const canonicalTurns = [
      { question: 'What is multiplication?', answer: 'It is repeated addition.' },
    ];

    await queue.submit(scenarioRequest, {
      turn: scenario.turn,
      conversationContext: createCanonicalConversationContext(canonicalTurns),
    });

    const visibleRequests = generatedRequests.filter((item) => item.kind !== 'extraction');
    expect(visibleRequests).toHaveLength(2);
    expect(visibleRequests[1].messages.slice(1)).toEqual(visibleRequests[0].messages.slice(1));
    expect(visibleRequests[1].messages[0].content).toMatch(/unnecessarily unhelpful/i);
    expect(visibleRequests[1].messages[0].content).toMatch(/practical guidance directly/i);
    expect(queue.getState().response).toBe('17 times 24 is 408.');
  });

  it('marks only the retried stage as a refusal retry in the dev trace', async () => {
    let attempts = 0;
    const generate = jest.fn((_generateRequest, onToken) => {
      attempts += 1;
      const response =
        attempts === 1
          ? "I don't have the tool needed to calculate that."
          : '17 times 24 is 408.';
      onToken(response, 6);
      return Promise.resolve({ response, tokenCount: 6 });
    });
    const queue = makeQueue({
      engine: { loadModel: () => Promise.resolve(), generate },
      isTraceEnabled: () => true,
    });

    await queue.submit(textRequest);

    const stages = queue.getState().inferenceTrace?.stages ?? [];
    expect(stages).toHaveLength(2);
    expect(stages[0]?.refusalRetry).toBeUndefined();
    expect(stages[1]?.refusalRetry).toBe(true);
  });

  it('does not retry a successful first response', async () => {
    const generate = jest.fn((_generateRequest, onToken) => {
      const response = '17 times 24 is 408.';
      onToken(response, 6);
      return Promise.resolve({ response, tokenCount: 6 });
    });
    const queue = makeQueue({ engine: { loadModel: () => Promise.resolve(), generate } });

    await queue.submit(textRequest);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(queue.getState().response).toBe('17 times 24 is 408.');
  });

  it('preserves the complete canonical follow-up context during a recovery retry', async () => {
    const generatedRequests: EngineGenerateRequest[] = [];
    const generate = jest.fn((generateRequest, onToken) => {
      generatedRequests.push(generateRequest);
      const response = generatedRequests.length === 1
        ? "I don't have a tool that can answer that."
        : 'It refers to the red bicycle from the image turn.';
      onToken(response, 8);
      return Promise.resolve({ response, tokenCount: 8 });
    });
    const queue = makeQueue({ engine: { loadModel: () => Promise.resolve(), generate } });
    const baseContext = createCanonicalConversationContext([
      {
        question: 'What is shown in this image?',
        answer: 'A red bicycle is leaning beside a garage.',
      },
      {
        question: 'Is it outdoors?',
        answer: 'Yes, it appears to be outdoors.',
      },
    ]);
    const conversationContext: CanonicalConversationContext = {
      ...baseContext,
      mediaEvidence: [
        {
          version: 'context-media-evidence-v1',
          id: 'user-image:image',
          sourceMessageId: 'user-image',
          modality: 'image',
          sourcePath: '/images/bicycle.jpg',
          summary: 'red bicycle',
          facts: ['leaning beside a garage'],
          extractedText: [],
          uncertainty: [],
          createdAt: 1,
        },
      ],
    };

    await queue.submit(
      { imagePath: null, question: 'What does it refer to?' },
      { turn: 'followUp', conversationContext },
    );

    expect(generatedRequests).toHaveLength(2);
    expect(generatedRequests[0].messages[0]?.content).toMatch(
      /final user message is the current request/i,
    );
    expect(generatedRequests[0].messages[0]?.content).toContain('red bicycle');
    expect(generatedRequests[1].messages.slice(1)).toEqual(
      generatedRequests[0].messages.slice(1),
    );
    expect(generatedRequests[1].messages[0]?.content).toMatch(
      /final user message is the current request/i,
    );
    expect(generatedRequests[1].messages[0]?.content).toContain('red bicycle');
    expect(generatedRequests[1].messages.map((message) => message.content)).toEqual(
      expect.arrayContaining([
        'What is shown in this image?',
        'A red bicycle is leaning beside a garage.',
        'What does it refer to?',
      ]),
    );
  });

  it('limits recovery to one retry when the second response is also a refusal', async () => {
    const generate = jest.fn((_generateRequest, onToken) => {
      const response = 'I need a tool to answer this.';
      onToken(response, 6);
      return Promise.resolve({ response, tokenCount: 6 });
    });
    const queue = makeQueue({ engine: { loadModel: () => Promise.resolve(), generate } });

    await queue.submit(textRequest);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(queue.getState().response).toBe('I need a tool to answer this.');
  });

  it('does not retry a genuine request for unavailable live information', async () => {
    const liveRequest: InferenceRequest = {
      imagePath: null,
      question: 'What is the live weather in Boston right now?',
    };
    const generate = jest.fn((_generateRequest, onToken) => {
      const response = 'I cannot access the required live weather tool.';
      onToken(response, 6);
      return Promise.resolve({ response, tokenCount: 6 });
    });
    const queue = makeQueue({ engine: { loadModel: () => Promise.resolve(), generate } });

    await queue.submit(liveRequest);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(queue.getState().response).toMatch(/cannot access/i);
  });

  it('uses the response mode captured for this request instead of the global default', async () => {
    const generatedRequests: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest) => {
        generatedRequests.push(generateRequest);
        return Promise.resolve({ response: 'Detailed answer.', tokenCount: 3 });
      },
    };
    const queue = makeQueue({ engine, getResponseMode: () => 'Low' });

    await queue.submit(
      { imagePath: null, question: 'Explain this.' },
      { responseMode: 'High' },
    );

    expect(generatedRequests[0]).toMatchObject({ responseMode: 'High' });
  });
});

describe('InferenceQueue two-stage first image turns', () => {
  it('uses one direct vision call for a normal image question', async () => {
    const generatedRequests: EngineGenerateRequest[] = [];
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (generateRequest, onToken) => {
        generatedRequests.push(generateRequest);
        onToken('A ceramic mug.', 4);
        return Promise.resolve({ response: 'A ceramic mug.', tokenCount: 4 });
      },
    };
    const queue = makeQueue({ engine });

    await queue.submit({ imagePath: '/tmp/mug.jpg', question: 'What is this?' });

    expect(generatedRequests).toHaveLength(1);
    expect(generatedRequests[0]).toMatchObject({ kind: 'answer', responseMode: 'Medium' });
    expect(generatedRequests[0].messages.at(-1)).toEqual(
      expect.objectContaining({ mediaPath: '/tmp/mug.jpg', content: 'What is this?' }),
    );
  });

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
      question: 'Read and compare the text in this new form.',
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
      conversationContext: createCanonicalConversationContext([
        { question: 'What was image A?', answer: 'Image A showed a metal pan.' },
      ]),
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

  it('stamps conversation and message attribution onto the dev trace', async () => {
    const queue = makeQueue({ isTraceEnabled: () => true });
    const attributedRequest: InferenceRequest = {
      ...request,
      requestId: 'request-1',
      conversationId: 'conversation-1',
      originatingUserMessageId: 'user-message-1',
      assistantMessageId: 'assistant-message-1',
    };

    await queue.submit(attributedRequest);

    const trace = queue.getState().inferenceTrace;
    expect(trace?.conversationId).toBe('conversation-1');
    expect(trace?.originatingUserMessageId).toBe('user-message-1');
    expect(trace?.assistantMessageId).toBe('assistant-message-1');
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

    expect(queue.getState().error).toBeNull();
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
        modelId: 'GEMMA4_E2B_MM',
        generationConfigId: 'gemma4-e2b-mm-library-default',
        pipelineVariantId: 'qwen-visible-sampling-v2',
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

describe('runtime-owned output length', () => {
  const OUTPUT_TOKEN_BUDGET = getResponseTokenBudget('Medium');
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
            if (streamedTokens >= OUTPUT_TOKEN_BUDGET) {
              clearInterval(interval);
              resolve({ response: `streamed ${streamedTokens} tokens.`, tokenCount: streamedTokens });
            }
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
    expect(state.limitWarning).toBeNull();
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
            if (streamedTokens >= OUTPUT_TOKEN_BUDGET) {
              clearInterval(interval);
              resolve({ response: `streamed ${streamedTokens} tokens.`, tokenCount: streamedTokens });
            }
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
    expect(state.finishReason).toBe('length');
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
    expect(state.finishReason).toBe('looping');
  });

  it('stops a streaming cycle early without classifying it as user cancellation', async () => {
    const sentenceCycle =
      'The laptop is open. Its screen shows a dark editor. It sits on a wooden desk. ';
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: async (generateRequest, onToken, signal) => {
        if (generateRequest.kind === 'extraction') {
          return { response: validExtractionJson, tokenCount: 10 };
        }
        onToken(sentenceCycle, 12);
        onToken(sentenceCycle.repeat(2), 24);
        onToken(sentenceCycle.repeat(3), 36);
        expect(signal.aborted).toBe(true);
        throw new Error('native completion stopped');
      },
    };
    const queue = makeQueue({ engine });

    await queue.submit(request);

    expect(queue.getState()).toEqual(expect.objectContaining({
      status: 'completed',
      finishReason: 'looping',
      response: sentenceCycle.trim(),
    }));
    expect(queue.getState().limitWarning).toMatch(/repeat/i);
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
