// Enforces constitution Principles II (single-flight), IV (memory-safe
// preprocessing before any tensor code), and III (OOM never crashes). This
// module has ZERO imports from src/screens/ or any UI/networking primitive —
// screens depend on it, never the reverse (contracts/inference-pipeline.contract.md,
// Principle X).

import type { IInferenceQueue } from '../types/interfaces';
import type { InferenceRequest, InferenceState, InferenceStatus } from '../types/models';

import { preprocessImage, type PreprocessedImage } from './ImagePreprocessor';
import { InferenceMetricsRecorder } from './InferenceMetrics';

/**
 * Plain-function adapter over the actual streaming model. In production this is
 * fulfilled by `useInferenceEngine` (T017), which isolates the single sanctioned
 * `useLLM` call; here the queue depends only on this narrow interface so it
 * stays hook-free and unit-testable.
 */
export interface InferenceEngineAdapter {
  /** Ensures the model is resident and ready; resolves once loaded. */
  loadModel(): Promise<void>;
  /**
   * Runs generation, invoking {@link onToken} with the cumulative response on
   * each streamed update, and resolving with the final response + token count.
   * MUST honour {@link signal} for cancellation.
   */
  generate(
    request: InferenceRequest,
    onToken: (cumulativeResponse: string) => void,
    signal: AbortSignal,
  ): Promise<{ response: string; tokenCount: number }>;
}

export interface InferenceQueueDeps {
  preprocess: (imagePath: string) => Promise<PreprocessedImage>;
  isReadyForInference: () => boolean;
  engine: InferenceEngineAdapter;
  /** Factory so each request gets a fresh recorder; defaults to a real one. */
  createRecorder?: () => InferenceMetricsRecorder;
}

const IN_FLIGHT: ReadonlyArray<InferenceStatus> = ['preprocessing', 'loading_model', 'streaming'];

const IDLE_STATE: InferenceState = {
  status: 'idle',
  response: '',
  metrics: null,
  error: null,
};

interface ActiveRequest {
  readonly controller: AbortController;
  cancelled: boolean;
}

export class InferenceQueue implements IInferenceQueue {
  private state: InferenceState = { ...IDLE_STATE };
  private readonly listeners = new Set<(state: InferenceState) => void>();
  private active: ActiveRequest | null = null;
  private readonly createRecorder: () => InferenceMetricsRecorder;

  constructor(private readonly deps: InferenceQueueDeps) {
    this.createRecorder = deps.createRecorder ?? (() => new InferenceMetricsRecorder());
  }

  getState(): InferenceState {
    return this.state;
  }

  subscribe(listener: (state: InferenceState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async submit(request: InferenceRequest): Promise<void> {
    // Single-flight guard (Principle II, FR-006): reject synchronously WITHOUT
    // acquiring the lock or mutating state if a request is already in-flight.
    // The module never trusts the caller to have disabled its own control.
    if (this.isInFlight()) {
      return Promise.reject(new Error('An inference is already in progress.'));
    }

    const active: ActiveRequest = { controller: new AbortController(), cancelled: false };
    this.active = active;
    const recorder = this.createRecorder();

    // Acquire the lock: reset any prior terminal state and enter 'preprocessing'.
    this.setState({ status: 'preprocessing', response: '', metrics: null, error: null });

    try {
      // Principle IV: the 512x512 ceiling is enforced before any model/tensor
      // code runs.
      recorder.markPreprocessingStart();
      const processed = await this.deps.preprocess(request.imagePath);
      recorder.markPreprocessingEnd();
      if (active.cancelled) return;

      if (!this.deps.isReadyForInference()) {
        throw new Error('The model is not downloaded and verified yet.');
      }

      this.setState({ status: 'loading_model' });
      recorder.markModelLoadStart();
      await this.deps.engine.loadModel();
      recorder.markModelLoadEnd();
      if (active.cancelled) return;

      this.setState({ status: 'streaming' });
      recorder.markInferenceStart();
      const result = await this.deps.engine.generate(
        { imagePath: processed.path, question: request.question },
        (cumulative) => {
          if (active.cancelled) return;
          recorder.markFirstToken();
          this.setState({ response: cumulative });
        },
        active.controller.signal,
      );
      if (active.cancelled) return;

      recorder.setTokenCount(result.tokenCount);
      recorder.markInferenceEnd();
      this.setState({ status: 'completed', response: result.response, metrics: recorder.build() });
    } catch (error) {
      // A cancel already drove state to its terminal value — don't overwrite it.
      if (active.cancelled) return;
      // OOM (or any failure) resolves to 'errored' with a human-readable message,
      // never an unhandled rejection or crash (FR-023, Principle III).
      this.setState({
        status: 'errored',
        response: '',
        metrics: null,
        error: toMessage(error),
      });
    } finally {
      // Release the lock on every exit path.
      if (this.active === active) {
        this.active = null;
      }
    }
  }

  cancel(): void {
    const active = this.active;
    if (active === null) return;

    active.cancelled = true;
    active.controller.abort();
    this.active = null;

    // Notify subscribers of the terminal 'cancelled' state (contract), discarding
    // the partial response so nothing residual is ever persisted (FR-007)...
    this.setState({ status: 'cancelled', response: '', metrics: null, error: null });
    // ...then return the queue to idle, ready to accept the next request.
    this.setState({ ...IDLE_STATE });
  }

  private isInFlight(): boolean {
    return IN_FLIGHT.includes(this.state.status);
  }

  private setState(patch: Partial<InferenceState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

/**
 * Default wiring. The `isReadyForInference` fallback is fail-closed (`() => false`)
 * — a queue built without a real readiness gate never loads the model. The
 * composition root (inferenceStore, T027) injects the real
 * `modelStore.isReadyForInference()` via `overrides`. `engine` must be supplied —
 * the real one arrives with `useInferenceEngine` (T017).
 */
export function createInferenceQueue(
  engine: InferenceEngineAdapter,
  overrides: Partial<InferenceQueueDeps> = {},
): InferenceQueue {
  return new InferenceQueue({
    preprocess: preprocessImage,
    isReadyForInference: () => false,
    engine,
    ...overrides,
  });
}

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return 'Inference failed for an unknown reason.';
}
