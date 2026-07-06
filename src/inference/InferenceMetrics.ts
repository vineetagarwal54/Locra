import type { PerformanceMetrics } from '../types/models';

// ExecuTorch's useLLM hook exposes NONE of the five FR-008 metrics — not model
// load time, preprocessing time, first-token latency, tokens/sec, nor total
// wall time. Every one of them is measured here by the app itself, by stamping
// the clock at each transition of the inference lifecycle. See research.md
// "Impact on metrics (FR-008)".

export type Clock = () => number;

/**
 * Records lifecycle timestamps for a single inference and computes the five
 * {@link PerformanceMetrics} fields from them. Inject a {@link Clock} for
 * deterministic tests; defaults to `Date.now`.
 */
export class InferenceMetricsRecorder {
  private readonly now: Clock;

  private modelLoadStart: number | null = null;
  private modelLoadEnd: number | null = null;
  private preprocessingStart: number | null = null;
  private preprocessingEnd: number | null = null;
  private inferenceStart: number | null = null;
  private firstTokenAt: number | null = null;
  private inferenceEnd: number | null = null;
  private tokenCount = 0;

  constructor(now: Clock = Date.now) {
    this.now = now;
  }

  markModelLoadStart(): void {
    this.modelLoadStart = this.now();
  }

  markModelLoadEnd(): void {
    this.modelLoadEnd = this.now();
  }

  markPreprocessingStart(): void {
    this.preprocessingStart = this.now();
  }

  markPreprocessingEnd(): void {
    this.preprocessingEnd = this.now();
  }

  /** The moment the generation request is dispatched (ExecuTorch `sendMessage`). */
  markInferenceStart(): void {
    this.inferenceStart = this.now();
  }

  /** First streamed token. Idempotent — only the earliest call counts. */
  markFirstToken(): void {
    if (this.firstTokenAt === null) {
      this.firstTokenAt = this.now();
    }
  }

  /** Generation complete (ExecuTorch `isGenerating` flips back to `false`). */
  markInferenceEnd(): void {
    this.inferenceEnd = this.now();
  }

  setTokenCount(count: number): void {
    this.tokenCount = count;
  }

  /**
   * Computes all five metrics. Throws if any required mark is missing — a
   * completed inference must never surface a partial metrics object (FR-008).
   */
  build(): PerformanceMetrics {
    const modelLoadStart = this.require(this.modelLoadStart, 'model load start');
    const modelLoadEnd = this.require(this.modelLoadEnd, 'model load end');
    const preprocessingStart = this.require(this.preprocessingStart, 'preprocessing start');
    const preprocessingEnd = this.require(this.preprocessingEnd, 'preprocessing end');
    const inferenceStart = this.require(this.inferenceStart, 'inference start');
    const firstTokenAt = this.require(this.firstTokenAt, 'first token');
    const inferenceEnd = this.require(this.inferenceEnd, 'inference end');

    // Decode throughput: tokens produced over the streaming window that follows
    // the first token (prefill/first-token latency is reported separately).
    const decodeMs = inferenceEnd - firstTokenAt;
    const tokensPerSecond = decodeMs > 0 ? (this.tokenCount / decodeMs) * 1000 : 0;

    return {
      modelLoadTimeMs: modelLoadEnd - modelLoadStart,
      preprocessingTimeMs: preprocessingEnd - preprocessingStart,
      firstTokenLatencyMs: firstTokenAt - inferenceStart,
      tokensPerSecond,
      totalWallTimeMs: inferenceEnd - inferenceStart,
    };
  }

  private require(value: number | null, label: string): number {
    if (value === null) {
      throw new Error(`InferenceMetrics: cannot build metrics — "${label}" was never recorded.`);
    }
    return value;
  }
}
