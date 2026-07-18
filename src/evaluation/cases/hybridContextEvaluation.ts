import type { ResponseMode } from '../../inference/ResponseMode';

export type EvaluationCategory =
  | 'short-chat'
  | 'long-chat'
  | 'image-follow-up'
  | 'retry'
  | 'response-mode'
  | 'voice'
  | 'memory'
  | 'storage'
  | 'latency';

export interface RepeatableEvaluationCase {
  readonly id: string;
  readonly category: EvaluationCategory;
  readonly responseModes: readonly ResponseMode[];
  readonly repetitions: number;
  readonly setup: readonly string[];
  readonly prompts: readonly string[];
  readonly expectedSignals: readonly string[];
}

export interface EvaluationMeasurement {
  readonly caseId: string;
  readonly responseMode: ResponseMode;
  readonly device: string;
  readonly firstTokenLatencyMs: number | null;
  readonly totalLatencyMs: number;
  readonly peakMemoryBytes: number | null;
  readonly storageBytes: number | null;
  readonly factualContinuityScore: 0 | 1 | 2;
  readonly contextPrecisionScore: 0 | 1 | 2;
  readonly passed: boolean;
  readonly notes: string;
}

export interface EvaluationSummary {
  readonly runs: number;
  readonly passRate: number;
  readonly averageTotalLatencyMs: number;
  readonly averageQualityScore: number;
}

export const HYBRID_CONTEXT_CASES: readonly RepeatableEvaluationCase[] = [
  caseDefinition('short-follow-up', 'short-chat', ['Low', 'Medium', 'High'], ['State an arrival time.', 'Recall it.']),
  caseDefinition('early-fact-recovery', 'long-chat', ['Medium', 'High'], ['Store an early fact.', 'Recall after 30 turns.']),
  caseDefinition('persisted-image-evidence', 'image-follow-up', ['Medium'], ['Inspect an image.', 'Ask two text follow-ups.']),
  caseDefinition('immutable-retry', 'retry', ['Medium'], ['Interrupt an answer.', 'Retry the failed attempt.']),
  caseDefinition('mode-monotonicity', 'response-mode', ['Low', 'Medium', 'High'], ['Run the same bounded request.']),
  caseDefinition('editable-voice-draft', 'voice', ['Medium'], ['Transcribe offline.', 'Edit before explicit send.']),
  caseDefinition('constrained-memory', 'memory', ['Low', 'Medium', 'High'], ['Run long context and record peak memory.']),
  caseDefinition('sql-and-model-storage', 'storage', ['Medium'], ['Seed 200 chats and record local storage.']),
  caseDefinition('retrieval-latency', 'latency', ['Low', 'Medium', 'High'], ['Run identical retrieval twice.']),
] as const;

export class EvaluationHarness {
  private readonly measurements: EvaluationMeasurement[] = [];

  record(measurement: EvaluationMeasurement): void {
    if (!HYBRID_CONTEXT_CASES.some((item) => item.id === measurement.caseId)) {
      throw new Error(`Unknown evaluation case: ${measurement.caseId}`);
    }
    this.measurements.push({ ...measurement });
  }

  results(): readonly EvaluationMeasurement[] {
    return this.measurements.map((measurement) => ({ ...measurement }));
  }

  summarize(): EvaluationSummary {
    if (this.measurements.length === 0) {
      return { runs: 0, passRate: 0, averageTotalLatencyMs: 0, averageQualityScore: 0 };
    }
    const total = this.measurements.length;
    return {
      runs: total,
      passRate: this.measurements.filter((item) => item.passed).length / total,
      averageTotalLatencyMs: average(this.measurements.map((item) => item.totalLatencyMs)),
      averageQualityScore: average(this.measurements.map(
        (item) => item.factualContinuityScore + item.contextPrecisionScore,
      )),
    };
  }
}

function caseDefinition(
  id: string,
  category: EvaluationCategory,
  responseModes: readonly ResponseMode[],
  prompts: readonly string[],
): RepeatableEvaluationCase {
  return {
    id, category, responseModes, repetitions: 2, setup: [], prompts,
    expectedSignals: ['No crash', 'No network call', 'Deterministic context selection'],
  };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
