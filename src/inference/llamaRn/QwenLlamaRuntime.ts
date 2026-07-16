// llama.rn Qwen3-VL-2B-Instruct runtime adapter (Spec 005, T028).
//
// Owns the single native llama.rn context behind the internal runtime boundary.
// The llama.rn binding is INJECTED so this module never loads the native package
// at import time and can be unit-tested with mocks; the real binding is wired in
// the Qwen host component. Only the startup-selected host constructs this runtime,
// so two contexts are never held at once.
//
// Isolation model: Locra supplies the FULL authoritative message context on every
// generate() call and this adapter never uses llama.rn's stateful session APIs —
// so no hidden native chat history is relied upon and no stale conversation state
// leaks between extraction, retries, visible answers, or later turns. Each
// generation is a fresh stateless completion over the supplied messages.

import type { GenerationFinishReason } from '../../types/models';
import type { ModelRequestMessage } from '../ContextBuilder';
import { trimMessagesToContextWithReport } from '../ContextWindow';
import { getResponseGenerationLimit, type ResponseMode } from '../ResponseMode';

import {
  convertToQwenMessages,
  QwenImageUnreadableError,
  type QwenChatMessage,
} from './QwenMessageConverter';
import {
  buildQwenInitLlamaParams,
  buildQwenInitMultimodalParams,
  QWEN_RUNTIME_CONFIG,
  type QwenInitLlamaParams,
  type QwenRuntimeConfig,
} from './QwenRuntimeConfig';

export type QwenRuntimeStatus =
  | 'unloaded'
  | 'loading'
  | 'loaded'
  | 'generating'
  | 'cancelling'
  | 'releasing'
  | 'errored';

// ── Minimal llama.rn 0.12.5 surface this adapter depends on ──────────────────

export interface QwenNativeTimings {
  predicted_per_second?: number;
  predicted_n?: number;
  predicted_ms?: number;
  prompt_n?: number;
}

export interface QwenNativeCompletionResult {
  content?: string;
  text?: string;
  tokens_predicted?: number;
  tokens_evaluated?: number;
  timings?: QwenNativeTimings;
  // llama.rn stop-reason flags. When present they are authoritative for the
  // finish reason; otherwise it is inferred from the generated token count.
  stopped_eos?: boolean;
  stopped_word?: boolean;
  stopped_limit?: boolean;
  truncated?: boolean;
}

export interface QwenNativeTokenData {
  token?: string;
}

export interface QwenCompletionParams {
  messages: QwenChatMessage[];
  n_predict: number;
  temperature: number;
}

export interface LlamaContextLike {
  initMultimodal(params: { path: string; use_gpu: boolean }): Promise<boolean | void>;
  isMultimodalEnabled(): Promise<boolean>;
  getMultimodalSupport(): Promise<{ vision: boolean; audio: boolean }>;
  completion(
    params: QwenCompletionParams,
    onToken?: (data: QwenNativeTokenData) => void
  ): Promise<QwenNativeCompletionResult>;
  stopCompletion(): Promise<void> | void;
  releaseMultimodal(): Promise<void>;
  release(): Promise<void>;
}

export interface LlamaBinding {
  initLlama(
    params: QwenInitLlamaParams,
    onProgress?: (percent: number) => void
  ): Promise<LlamaContextLike>;
  releaseAllLlama(): Promise<void>;
}

// ── Requests / results ───────────────────────────────────────────────────────

export interface QwenLoadRequest {
  modelPath: string;
  projectorPath: string;
  onProgress?: (percent: number) => void;
}

export interface QwenGenerateRequest {
  /** The full authoritative supplied context for this turn. */
  messages: ModelRequestMessage[];
  signal: AbortSignal;
  onToken: (cumulativeText: string, generatedTokenCount?: number) => void;
  responseMode: ResponseMode;
}

export interface QwenGenerateResult {
  text: string;
  promptTokens: number;
  generatedTokens: number;
  totalTokens: number;
  tokensPerSecond: number;
  firstTokenLatencyMs: number;
  totalWallTimeMs: number;
  /** `natural` when the model stopped on its own; `length` when the output cap was hit. */
  finishReason: GenerationFinishReason;
  /** Set when the supplied input had to be shortened to fit the context window. */
  inputShortenedWarning: string | null;
}

// ── Typed errors (surfaced to the queue/store boundary) ──────────────────────

export class QwenLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QwenLoadError';
  }
}

export class QwenProjectorInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QwenProjectorInitError';
  }
}

export class QwenNotLoadedError extends Error {
  constructor(message = 'The Qwen runtime is not loaded.') {
    super(message);
    this.name = 'QwenNotLoadedError';
  }
}

export class QwenGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QwenGenerationError';
  }
}

export class QwenGenerationCancelledError extends Error {
  constructor() {
    super('Generation was cancelled.');
    this.name = 'QwenGenerationCancelledError';
  }
}

export interface QwenLlamaRuntimeDeps {
  llama: LlamaBinding;
  /** True only when the processed local file exists and is readable/non-empty. */
  isReadableFile: (fileUri: string) => boolean;
  config?: QwenRuntimeConfig;
  now?: () => number;
}

export class QwenLlamaRuntime {
  private status: QwenRuntimeStatus = 'unloaded';
  private context: LlamaContextLike | null = null;
  private loadedModelPath: string | null = null;
  private loadedProjectorPath: string | null = null;
  private multimodalEnabled = false;
  private multimodalVision = false;
  private projectorError: string | null = null;
  private error: string | null = null;
  private loadPromise: Promise<void> | null = null;
  private cancelRequested = false;
  private readonly config: QwenRuntimeConfig;
  private readonly now: () => number;

  constructor(private readonly deps: QwenLlamaRuntimeDeps) {
    this.config = deps.config ?? QWEN_RUNTIME_CONFIG;
    this.now = deps.now ?? Date.now;
  }

  getStatus(): QwenRuntimeStatus {
    return this.status;
  }

  getError(): string | null {
    return this.error;
  }

  isMultimodalVisionReady(): boolean {
    return this.multimodalEnabled && this.multimodalVision;
  }

  /**
   * Idempotent load: if the model and projector are already loaded for the same
   * verified artifact set, returns immediately without reloading or a duplicate
   * projector initialization. Concurrent calls share one in-flight load.
   */
  async loadModel(request: QwenLoadRequest): Promise<void> {
    if (
      this.context !== null &&
      this.loadedModelPath === request.modelPath &&
      this.loadedProjectorPath === request.projectorPath
    ) {
      return;
    }
    if (this.loadPromise !== null) {
      return this.loadPromise;
    }
    if (this.context !== null) {
      // A different artifact set is loaded; release before loading the new one.
      await this.release();
    }
    const promise = this.performLoad(request).finally(() => {
      if (this.loadPromise === promise) {
        this.loadPromise = null;
      }
    });
    this.loadPromise = promise;
    return promise;
  }

  private async performLoad(request: QwenLoadRequest): Promise<void> {
    this.status = 'loading';
    this.error = null;

    let context: LlamaContextLike;
    try {
      context = await this.deps.llama.initLlama(
        buildQwenInitLlamaParams(request.modelPath, this.config),
        request.onProgress
      );
    } catch (error) {
      this.status = 'errored';
      this.error = toMessage(error);
      throw new QwenLoadError(toMessage(error));
    }

    try {
      await context.initMultimodal(
        buildQwenInitMultimodalParams(request.projectorPath, this.config)
      );
      const enabled = await context.isMultimodalEnabled();
      const support = await context.getMultimodalSupport();
      if (!enabled || !support.vision) {
        throw new Error('Multimodal vision support is unavailable for the projector.');
      }
      this.multimodalEnabled = enabled;
      this.multimodalVision = support.vision;
    } catch (error) {
      // The language context remains usable for text-only inference. Vision
      // requests receive the projector error below and can retry after repair.
      await safe(() => context.releaseMultimodal());
      this.multimodalEnabled = false;
      this.multimodalVision = false;
      this.projectorError = toMessage(error);
    }

    this.context = context;
    this.loadedModelPath = request.modelPath;
    this.loadedProjectorPath = request.projectorPath;
    this.status = 'loaded';
  }

  async generate(request: QwenGenerateRequest): Promise<QwenGenerateResult> {
    const context = this.context;
    if (context === null || this.status !== 'loaded') {
      throw new QwenNotLoadedError();
    }
    const requiresVision = request.messages.some((message) => message.mediaPath !== undefined);
    if (requiresVision && !this.isMultimodalVisionReady()) {
      throw new QwenProjectorInitError(
        this.projectorError ?? 'Multimodal vision support is not confirmed.',
      );
    }

    // Convert BEFORE flipping to 'generating' so an unreadable image leaves the
    // runtime cleanly 'loaded'. Only the supplied messages are used.
    const bounded = trimMessagesToContextWithReport(request.messages, request.responseMode);
    const messages = convertToQwenMessages(bounded.messages, {
      isReadableFile: this.deps.isReadableFile,
    });
    const inputShortenedWarning = bounded.inputShortenedWarning;

    if (request.signal.aborted) {
      throw new QwenGenerationCancelledError();
    }

    this.status = 'generating';
    this.cancelRequested = false;
    this.error = null;
    const startedAt = this.now();
    let firstTokenAt: number | null = null;
    let cumulativeRaw = '';
    let streamedTokenCount = 0;
    // Hard output cap handed to the native runtime. Reaching it means the answer
    // is length-truncated (finishReason === 'length'), never a natural stop.
    const generationLimit = getResponseGenerationLimit(request.responseMode);

    const onAbort = (): void => {
      this.cancel();
    };
    request.signal.addEventListener('abort', onAbort);

    try {
      const result = await context.completion(
        {
          messages,
          n_predict: generationLimit,
          temperature: this.config.temperature,
        },
        (data) => {
          if (firstTokenAt === null) {
            firstTokenAt = this.now();
          }
          cumulativeRaw += data.token ?? '';
          streamedTokenCount += 1;
          request.onToken(stripControlTags(cumulativeRaw), streamedTokenCount);
        }
      );

      if (this.cancelRequested || request.signal.aborted) {
        this.status = 'loaded';
        throw new QwenGenerationCancelledError();
      }

      const text = stripControlTags(result.content ?? result.text ?? cumulativeRaw).trim();
      this.status = 'loaded';
      return this.buildResult(
        text,
        result,
        startedAt,
        firstTokenAt,
        streamedTokenCount,
        generationLimit,
        inputShortenedWarning,
      );
    } catch (error) {
      if (error instanceof QwenGenerationCancelledError) {
        this.status = 'loaded';
        throw error;
      }
      if (this.cancelRequested || request.signal.aborted) {
        this.status = 'loaded';
        throw new QwenGenerationCancelledError();
      }
      this.status = 'errored';
      this.error = toMessage(error);
      throw new QwenGenerationError(toMessage(error));
    } finally {
      request.signal.removeEventListener('abort', onAbort);
    }
  }

  cancel(): void {
    if (this.status !== 'generating' && this.status !== 'cancelling') {
      return;
    }
    this.cancelRequested = true;
    this.status = 'cancelling';
    const context = this.context;
    if (context !== null) {
      void safe(() => Promise.resolve(context.stopCompletion()));
    }
  }

  /** Releases the projector before the context, leaving getStatus() === 'unloaded'. */
  async release(): Promise<void> {
    this.status = 'releasing';
    const context = this.context;
    if (context !== null) {
      await safe(() => context.releaseMultimodal());
      await safe(() => context.release());
    }
    await safe(() => this.deps.llama.releaseAllLlama());
    this.context = null;
    this.loadedModelPath = null;
    this.loadedProjectorPath = null;
    this.multimodalEnabled = false;
    this.multimodalVision = false;
    this.projectorError = null;
    this.error = null;
    this.status = 'unloaded';
  }

  private buildResult(
    text: string,
    result: QwenNativeCompletionResult,
    startedAt: number,
    firstTokenAt: number | null,
    streamedTokenCount: number,
    generationLimit: number,
    inputShortenedWarning: string | null,
  ): QwenGenerateResult {
    const totalWallTimeMs = this.now() - startedAt;
    const timings = result.timings ?? {};
    const generatedTokens = result.tokens_predicted ?? timings.predicted_n ?? streamedTokenCount;
    const promptTokens = result.tokens_evaluated ?? timings.prompt_n ?? 0;
    const firstTokenLatencyMs = firstTokenAt !== null ? firstTokenAt - startedAt : 0;

    let tokensPerSecond = timings.predicted_per_second ?? 0;
    if (tokensPerSecond === 0 && timings.predicted_ms && generatedTokens > 0) {
      tokensPerSecond = (generatedTokens / timings.predicted_ms) * 1000;
    }
    if (tokensPerSecond === 0 && totalWallTimeMs > 0 && generatedTokens > 0) {
      tokensPerSecond = (generatedTokens / totalWallTimeMs) * 1000;
    }

    return {
      text,
      promptTokens,
      generatedTokens,
      totalTokens: promptTokens + generatedTokens,
      tokensPerSecond,
      firstTokenLatencyMs,
      totalWallTimeMs,
      finishReason: resolveFinishReason(result, generatedTokens, generationLimit),
      inputShortenedWarning,
    };
  }
}

/**
 * Prefers the native stop-reason flags when llama.rn reports them; otherwise
 * infers a length stop by comparing generated tokens against the hard cap. The
 * count comparison uses `>=` because a run that produced the full cap could not
 * have also emitted a stop token.
 */
function resolveFinishReason(
  result: QwenNativeCompletionResult,
  generatedTokens: number,
  generationLimit: number,
): GenerationFinishReason {
  if (result.stopped_limit === true || result.truncated === true) {
    return 'length';
  }
  if (result.stopped_eos === true || result.stopped_word === true) {
    return 'natural';
  }
  return generationLimit > 0 && generatedTokens >= generationLimit ? 'length' : 'natural';
}

export { QwenImageUnreadableError };

/**
 * Narrow defensive guard: strips accidental `<think>`/`</think>` control tags
 * only. It removes the literal tag markers, never the content between them — so a
 * wrong (Thinking) model or template still surfaces as visibly wrong output
 * rather than being silently hidden.
 */
export function stripControlTags(text: string): string {
  return text.replace(/<\/?think>/gi, '');
}

function toMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'Qwen runtime error.';
}

async function safe(action: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await action();
  } catch {
    // Best-effort cleanup; release/cancel must never throw.
  }
}
