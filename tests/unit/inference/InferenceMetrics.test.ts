import { InferenceMetricsRecorder } from '../../../src/inference/InferenceMetrics';

// A controllable clock so every timestamp under test is deterministic.
// ExecuTorch provides NONE of these five metrics — the app measures them all.
function makeClock(): { advanceTo: (t: number) => void; now: () => number } {
  let current = 0;
  return {
    advanceTo: (t: number) => {
      current = t;
    },
    now: () => current,
  };
}

describe('InferenceMetricsRecorder', () => {
  it('computes model load time from the load start/end timestamps', () => {
    const clock = makeClock();
    const recorder = new InferenceMetricsRecorder(clock.now);

    clock.advanceTo(1000);
    recorder.markModelLoadStart();
    clock.advanceTo(3500);
    recorder.markModelLoadEnd();

    recordRemainderThrough(recorder, clock);
    const metrics = recorder.build();

    expect(metrics.modelLoadTimeMs).toBe(2500);
  });

  it('computes preprocessing time from the preprocessing start/end timestamps', () => {
    const clock = makeClock();
    const recorder = new InferenceMetricsRecorder(clock.now);

    seedModelLoad(recorder, clock);
    clock.advanceTo(4000);
    recorder.markPreprocessingStart();
    clock.advanceTo(4120);
    recorder.markPreprocessingEnd();
    seedInference(recorder, clock);

    expect(recorder.build().preprocessingTimeMs).toBe(120);
  });

  it('computes first-token latency from inference start to the first token', () => {
    const clock = makeClock();
    const recorder = new InferenceMetricsRecorder(clock.now);

    seedModelLoad(recorder, clock);
    seedPreprocessing(recorder, clock);
    clock.advanceTo(5000);
    recorder.markInferenceStart();
    clock.advanceTo(5300);
    recorder.markFirstToken();
    clock.advanceTo(7000);
    recorder.markFirstToken(); // later tokens must not move first-token latency
    recorder.setTokenCount(50);
    clock.advanceTo(7000);
    recorder.markInferenceEnd();

    expect(recorder.build().firstTokenLatencyMs).toBe(300);
  });

  it('computes tokens/sec from token count and the decode elapsed time', () => {
    const clock = makeClock();
    const recorder = new InferenceMetricsRecorder(clock.now);

    seedModelLoad(recorder, clock);
    seedPreprocessing(recorder, clock);
    clock.advanceTo(5000);
    recorder.markInferenceStart();
    clock.advanceTo(6000);
    recorder.markFirstToken();
    recorder.setTokenCount(100);
    clock.advanceTo(8000); // 2s of decode after the first token
    recorder.markInferenceEnd();

    expect(recorder.build().tokensPerSecond).toBe(50);
  });

  it('computes total wall time from inference start to inference end', () => {
    const clock = makeClock();
    const recorder = new InferenceMetricsRecorder(clock.now);

    seedModelLoad(recorder, clock);
    seedPreprocessing(recorder, clock);
    clock.advanceTo(5000);
    recorder.markInferenceStart();
    clock.advanceTo(5300);
    recorder.markFirstToken();
    recorder.setTokenCount(10);
    clock.advanceTo(9500);
    recorder.markInferenceEnd();

    expect(recorder.build().totalWallTimeMs).toBe(4500);
  });

  it('produces all five metrics together on a completed result (FR-008)', () => {
    const clock = makeClock();
    const recorder = new InferenceMetricsRecorder(clock.now);

    clock.advanceTo(0);
    recorder.markModelLoadStart();
    clock.advanceTo(2000);
    recorder.markModelLoadEnd();
    clock.advanceTo(2100);
    recorder.markPreprocessingStart();
    clock.advanceTo(2250);
    recorder.markPreprocessingEnd();
    clock.advanceTo(2300);
    recorder.markInferenceStart();
    clock.advanceTo(2500);
    recorder.markFirstToken();
    recorder.setTokenCount(80);
    clock.advanceTo(4500);
    recorder.markInferenceEnd();

    const metrics = recorder.build();

    expect(metrics).toEqual({
      modelLoadTimeMs: 2000,
      preprocessingTimeMs: 150,
      firstTokenLatencyMs: 200,
      tokensPerSecond: 40,
      totalWallTimeMs: 2200,
    });
    // Never a subset: every field is a finite number.
    for (const value of Object.values(metrics)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('computes two-stage objective timings for production result records', () => {
    const clock = makeClock();
    const recorder = new InferenceMetricsRecorder(clock.now);

    clock.advanceTo(100);
    recorder.markRequestStart();
    clock.advanceTo(250);
    recorder.markPerceptionStart();
    clock.advanceTo(850);
    recorder.markPerceptionEnd();
    clock.advanceTo(900);
    recorder.markAnswerStart();
    clock.advanceTo(1125);
    recorder.markAnswerFirstToken();
    clock.advanceTo(2100);
    recorder.markAnswerEnd();

    expect(recorder.buildObjectiveTimings()).toEqual({
      perceptionLatencyMs: 600,
      answerTtftMs: 225,
      answerGenerationLatencyMs: 1200,
      totalEndToEndLatencyMs: 2000,
    });
  });

  it('throws rather than emitting a partial metrics object when a mark is missing', () => {
    const clock = makeClock();
    const recorder = new InferenceMetricsRecorder(clock.now);
    recorder.markModelLoadStart();
    recorder.markModelLoadEnd();

    expect(() => recorder.build()).toThrow();
  });
});

// --- helpers to fill in the marks a given test is not asserting on ---

function seedModelLoad(recorder: InferenceMetricsRecorder, clock: ReturnType<typeof makeClock>): void {
  clock.advanceTo(0);
  recorder.markModelLoadStart();
  clock.advanceTo(100);
  recorder.markModelLoadEnd();
}

function seedPreprocessing(recorder: InferenceMetricsRecorder, clock: ReturnType<typeof makeClock>): void {
  clock.advanceTo(100);
  recorder.markPreprocessingStart();
  clock.advanceTo(200);
  recorder.markPreprocessingEnd();
}

function seedInference(recorder: InferenceMetricsRecorder, clock: ReturnType<typeof makeClock>): void {
  clock.advanceTo(1000);
  recorder.markInferenceStart();
  clock.advanceTo(1100);
  recorder.markFirstToken();
  recorder.setTokenCount(10);
  clock.advanceTo(2100);
  recorder.markInferenceEnd();
}

function recordRemainderThrough(
  recorder: InferenceMetricsRecorder,
  clock: ReturnType<typeof makeClock>,
): void {
  seedPreprocessing(recorder, clock);
  seedInference(recorder, clock);
}
