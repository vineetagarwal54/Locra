import {
  EvaluationHarness,
  HYBRID_CONTEXT_CASES,
} from '../../../src/evaluation/cases/hybridContextEvaluation';

describe('hybrid context evaluation harness', () => {
  it('covers every required repeatable category and summarizes measurements', () => {
    expect(new Set(HYBRID_CONTEXT_CASES.map((item) => item.category))).toEqual(new Set([
      'short-chat', 'long-chat', 'image-follow-up', 'retry', 'selected-chat',
      'response-mode', 'voice', 'memory', 'storage', 'latency',
    ]));
    const harness = new EvaluationHarness();
    harness.record({
      caseId: 'short-follow-up', responseMode: 'Medium', device: 'test',
      firstTokenLatencyMs: 100, totalLatencyMs: 500, peakMemoryBytes: 1_000,
      storageBytes: 2_000, factualContinuityScore: 2, contextPrecisionScore: 2,
      passed: true, notes: '',
    });
    expect(harness.summarize()).toEqual({
      runs: 1, passRate: 1, averageTotalLatencyMs: 500, averageQualityScore: 4,
    });
  });
});
