import { SingleFlightResourcePolicy } from '../../../src/inference/DeviceResourcePolicy';
import {
  CONSTRAINED_PLANNER_CONFIDENCE_THRESHOLD,
  CONSTRAINED_PLANNER_MAX_TOKENS,
  CONSTRAINED_PLANNER_TIMEOUT_MS,
  evaluateConstrainedPlannerGate,
  runConstrainedPlannerFallback,
  type ConstrainedPlannerModel,
} from '../../../src/planning/ConstrainedPlannerFallback';

function validOutput(): unknown {
  return {
    candidateReferenceIdsReceived: ['image-a', 'image-b'],
    selectedReferenceIds: ['image-b'],
    referenceStatus: 'resolved',
    intentClarification: null,
    memoryInterpretation: 'unresolved',
    requestedContextScope: 'recent',
    confidence: 0.9,
    rationaleCodes: ['candidate-description-match'],
    clarificationRequired: false,
  };
}

function gateInput() {
  return {
    unresolvedFields: ['reference' as const],
    candidateReferenceIds: ['image-a', 'image-b'],
    materiallyPlausibleInterpretationCount: 2,
    ordinaryIndependentQuestion: false,
    clearImageTurn: false,
    explicitMemoryWrite: false,
    explicitMemoryRecall: false,
    action: 'answer' as const,
  };
}

describe('ConstrainedPlannerFallback', () => {
  it('opens only for multiple materially plausible unresolved interpretations', () => {
    expect(evaluateConstrainedPlannerGate(gateInput())).toEqual({
      invoke: true,
      reason: 'multiple-material-interpretations',
    });
    expect(evaluateConstrainedPlannerGate({
      ...gateInput(),
      materiallyPlausibleInterpretationCount: 1,
    }).invoke).toBe(false);
  });

  it.each([
    ['ordinary independent question', { ordinaryIndependentQuestion: true }],
    ['clear image turn', { clearImageTurn: true }],
    ['explicit memory write', { explicitMemoryWrite: true }],
    ['explicit memory recall', { explicitMemoryRecall: true }],
    ['retry', { action: 'retry' as const }],
    ['regenerate', { action: 'regenerate' as const }],
    ['continuation', { action: 'continue' as const }],
  ])('does not invoke for %s', (_label, override) => {
    expect(evaluateConstrainedPlannerGate({ ...gateInput(), ...override }).invoke).toBe(false);
  });

  it('passes bounded candidates and generation limits under the shared resource policy', async () => {
    const generateResolution = jest.fn(async () => validOutput());
    const model: ConstrainedPlannerModel = { generateResolution };
    const result = await runConstrainedPlannerFallback({
      gate: gateInput(),
      model,
      resourcePolicy: new SingleFlightResourcePolicy(),
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('accepted');
    expect(result.resolution?.selectedReferenceIds).toEqual(['image-b']);
    expect(generateResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateReferenceIds: ['image-a', 'image-b'],
        unresolvedFields: ['reference'],
        maxGeneratedTokens: CONSTRAINED_PLANNER_MAX_TOKENS,
      }),
      expect.any(AbortSignal),
    );
    expect(result.diagnostics.timeoutMs).toBe(CONSTRAINED_PLANNER_TIMEOUT_MS);
    expect(result.diagnostics.confidenceThreshold)
      .toBe(CONSTRAINED_PLANNER_CONFIDENCE_THRESHOLD);
  });

  it('rejects candidate injection, malformed output, and low confidence conservatively', async () => {
    const outputs = [
      { ...validOutput() as Record<string, unknown>, selectedReferenceIds: ['image-c'] },
      { invalid: true },
      { ...validOutput() as Record<string, unknown>, confidence: 0.79 },
    ];

    for (const output of outputs) {
      const result = await runConstrainedPlannerFallback({
        gate: gateInput(),
        model: { generateResolution: async () => output },
        resourcePolicy: new SingleFlightResourcePolicy(),
        signal: new AbortController().signal,
      });
      expect(result.status).toBe('rejected');
      expect(result.resolution).toBeNull();
      expect(result.fallback.clarificationRequired).toBe(true);
      expect(result.fallback.preserveCandidateReferenceIds)
        .toEqual(['image-a', 'image-b']);
    }
  });

  it('cancels cleanly and releases the resource for the next operation', async () => {
    const controller = new AbortController();
    const resourcePolicy = new SingleFlightResourcePolicy();
    const resultPromise = runConstrainedPlannerFallback({
      gate: gateInput(),
      model: {
        generateResolution: async (_request, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
      },
      resourcePolicy,
      signal: controller.signal,
    });

    controller.abort();
    const result = await resultPromise;

    expect(result.status).toBe('cancelled');
    expect(resourcePolicy.current()).toBeNull();
    expect(resourcePolicy.tryAcquire('qwen-answer')).not.toBeNull();
  });

  it('times out or suspends with the same conservative fallback', async () => {
    jest.useFakeTimers();
    const timeoutPromise = runConstrainedPlannerFallback({
      gate: gateInput(),
      model: {
        generateResolution: async () => new Promise<unknown>(() => undefined),
      },
      resourcePolicy: new SingleFlightResourcePolicy(),
      signal: new AbortController().signal,
      timeoutMs: 5,
    });
    await jest.advanceTimersByTimeAsync(5);
    const timeout = await timeoutPromise;
    jest.useRealTimers();

    const suspension = new AbortController();
    suspension.abort('app-suspended');
    const suspended = await runConstrainedPlannerFallback({
      gate: gateInput(),
      model: { generateResolution: async () => validOutput() },
      resourcePolicy: new SingleFlightResourcePolicy(),
      signal: suspension.signal,
      cancellationKind: 'suspended',
    });

    expect(timeout.status).toBe('timed-out');
    expect(suspended.status).toBe('suspended');
    expect(timeout.fallback.preserveAttachedImages).toBe(true);
    expect(suspended.fallback.preserveExplicitReferences).toBe(true);
  });
});
