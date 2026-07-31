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
import { postProcessAnswer } from '../AnswerPostProcessor';
import type { ModelRequestMessage } from '../ContextBuilder';
import {
  reconcileMessagesWithNativeTokenizer,
  trimMessagesToContextWithReport,
  type NativePromptReconciliation,
} from '../ContextWindow';
import {
  samplingProfileForRequestKind,
  type SamplingProfile,
} from '../GenerationTuning';
import type {
  GenerationRuntimeDiagnostics,
  GenerationRuntimeStageEvent,
} from '../InferenceEngineHandle';
import {
  getResponseGenerationLimit,
  getResponseModeConfig,
  type ResponseMode,
} from '../ResponseMode';
import {
  STRUCTURED_VISUAL_EXTRACTION_JSON_SCHEMA,
  STRUCTURED_VISUAL_EXTRACTION_SCHEMA_VERSION,
} from '../StructuredVisualExtraction';

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

const LOOP_CHECK_TOKEN_INTERVAL = 16;
const LOOP_CHECK_MINIMUM_CHARS = 200;

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
  n_probs?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  xtc_probability?: number;
  xtc_threshold?: number;
  typical_p?: number;
  temperature?: number;
  penalty_last_n?: number;
  penalty_repeat?: number;
  penalty_freq?: number;
  penalty_present?: number;
  mirostat?: number;
  mirostat_tau?: number;
  mirostat_eta?: number;
  dry_multiplier?: number;
  dry_base?: number;
  dry_allowed_length?: number;
  dry_penalty_last_n?: number;
  dry_sequence_breakers?: string[];
  top_n_sigma?: number;
  ignore_eos?: boolean;
  logit_bias?: number[][];
  seed?: number;
  guide_tokens?: number[];
  response_format?: {
    readonly type: 'json_schema';
    readonly json_schema: {
      readonly name: 'locra_visual_evidence';
      readonly strict: true;
      readonly schema: object;
    };
  };
}

export interface LlamaContextLike {
  initMultimodal(params: { path: string; use_gpu: boolean }): Promise<boolean | void>;
  isMultimodalEnabled(): Promise<boolean>;
  getMultimodalSupport(): Promise<{ vision: boolean; audio: boolean }>;
  getFormattedChat(messages: QwenChatMessage[]): Promise<{
    readonly prompt: string;
    readonly media_paths?: string[];
  }>;
  tokenize(
    text: string,
    options?: { readonly media_paths?: string[] },
  ): Promise<{ readonly tokens: number[]; readonly has_media: boolean }>;
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
  kind?: 'extraction' | 'extractionRetry' | 'answer' | 'chat' | 'compaction';
  softTargetTokens?: number;
  hardSafetyLimitTokens?: number;
  gracefulCompletionReserveTokens?: number;
  generationPlanId?: string;
  generationTaskKind?: import('../GenerationTuning').GenerationTaskKind;
  loopDetectionEligible?: boolean;
  onRuntimeStage?: (event: GenerationRuntimeStageEvent) => void;
}

export interface QwenGenerateResult {
  text: string;
  estimatedPromptTokens: number;
  finalNativePromptTokens: number;
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
  samplingProfile: SamplingProfile;
  generationDiagnostics: import('../InferenceEngineHandle').GenerationRuntimeDiagnostics;
}

// ── Typed errors (surfaced to the queue/store boundary) ──────────────────────

function usesStructuredExtraction(
  kind: QwenGenerateRequest['kind'],
): boolean {
  return kind === 'extraction' || kind === 'extractionRetry';
}

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
  private nativeStopRequested = false;
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
    this.status = 'generating';
    this.cancelRequested = false;
    this.nativeStopRequested = false;
    this.error = null;
    const onAbort = (): void => {
      this.cancel();
    };
    request.signal.addEventListener('abort', onAbort);
    let reconciled: NativePromptReconciliation;
    try {
      reconciled = await reconcileMessagesWithNativeTokenizer(
        bounded.messages,
        request.responseMode,
        async (candidate) => {
          const qwenMessages = convertToQwenMessages([...candidate], {
            isReadableFile: this.deps.isReadableFile,
          });
          notifyRuntimeStage(request, 'prompt-formatting', 'started');
          let formatted: Awaited<ReturnType<LlamaContextLike['getFormattedChat']>>;
          try {
            formatted = await context.getFormattedChat(qwenMessages);
          } finally {
            notifyRuntimeStage(request, 'prompt-formatting', 'completed');
          }
          const tokenizationStage =
            formatted.media_paths === undefined || formatted.media_paths.length === 0
              ? 'prompt-tokenization'
              : 'media-tokenization';
          notifyRuntimeStage(request, tokenizationStage, 'started');
          let tokenized: Awaited<ReturnType<LlamaContextLike['tokenize']>>;
          try {
            tokenized = await context.tokenize(formatted.prompt, {
              media_paths: formatted.media_paths,
            });
          } finally {
            notifyRuntimeStage(request, tokenizationStage, 'completed');
          }
          return tokenized.tokens.length;
        },
      );
    } catch (error) {
      request.signal.removeEventListener('abort', onAbort);
      if (this.cancelRequested || request.signal.aborted) {
        this.status = 'loaded';
        throw new QwenGenerationCancelledError();
      }
      this.status = 'errored';
      this.error = toMessage(error);
      throw new QwenGenerationError(toMessage(error));
    }
    const messages = convertToQwenMessages(reconciled.messages, {
      isReadableFile: this.deps.isReadableFile,
    });
    const inputShortenedWarning =
      bounded.inputShortenedWarning ??
      (reconciled.currentInputShortened
        ? 'Your message was long, so Locra kept the beginning and end and trimmed the middle to fit.'
        : null);

    if (request.signal.aborted) {
      this.status = 'loaded';
      request.signal.removeEventListener('abort', onAbort);
      throw new QwenGenerationCancelledError();
    }

    const startedAt = this.now();
    let firstTokenAt: number | null = null;
    let cumulativeRaw = '';
    let streamedTokenCount = 0;
    let loopStoppedText: string | null = null;
    let semanticStoppedText: string | null = null;
    let gracefulCompletionModeEntered = false;
    let prefillActive = true;
    let generationActive = false;
    // This is an emergency device/runtime ceiling, not the answer-length target.
    // Whether reaching it actually truncated the answer is decided from the
    // completed output structure below.
    const generationLimit = Math.min(
      getResponseGenerationLimit(request.responseMode),
      request.hardSafetyLimitTokens ?? Number.POSITIVE_INFINITY,
    );
    const targetTokenBudget =
      request.softTargetTokens ?? getResponseModeConfig(request.responseMode).answerTargetTokens;
    const gracefulCompletionReserveTokens = resolveGracefulCompletionReserve(
      generationLimit,
      request.gracefulCompletionReserveTokens,
    );
    const gracefulCompletionThreshold =
      generationLimit - gracefulCompletionReserveTokens;
    const taskKind = request.generationTaskKind ?? defaultTaskKind(request.kind);
    const samplingProfile = samplingProfileForRequestKind(request.kind);

    try {
      notifyRuntimeStage(request, 'prefill', 'started');
      const result = await context.completion(
        {
          messages,
          n_predict: generationLimit,
          temperature: samplingProfile.temperature,
          top_p: samplingProfile.topP,
          top_k: samplingProfile.topK,
          ...(usesStructuredExtraction(request.kind)
            ? {
                response_format: {
                  type: 'json_schema' as const,
                  json_schema: {
                    name: 'locra_visual_evidence' as const,
                    strict: true as const,
                    schema: STRUCTURED_VISUAL_EXTRACTION_JSON_SCHEMA,
                  },
                },
              }
            : {}),
        },
        (data) => {
          if (firstTokenAt === null) {
            firstTokenAt = this.now();
            prefillActive = false;
            notifyRuntimeStage(request, 'prefill', 'completed');
            generationActive = true;
            notifyRuntimeStage(request, 'generation', 'started');
          }
          cumulativeRaw += data.token ?? '';
          streamedTokenCount += 1;
          const visible = stripControlTags(cumulativeRaw);
          if (streamedTokenCount >= gracefulCompletionThreshold) {
            gracefulCompletionModeEntered = true;
          }
          if (
            (request.loopDetectionEligible ??
              (request.kind !== 'extraction' && request.kind !== 'extractionRetry')) &&
            loopStoppedText === null
            && streamedTokenCount % LOOP_CHECK_TOKEN_INTERVAL === 0
            && visible.length >= LOOP_CHECK_MINIMUM_CHARS
          ) {
            const processed = postProcessAnswer(visible);
            if (processed.verdict === 'looping') {
              loopStoppedText = processed.text;
              request.onToken(processed.text, streamedTokenCount);
              this.requestNativeStop(context);
              return;
            }
          }
          if (
            loopStoppedText === null
            && semanticStoppedText === null
            && gracefulCompletionModeEntered
            && isGracefulRuntimeStopEligible(request.kind, taskKind)
            && hasStrongSemanticCompletionBoundary(visible, taskKind)
          ) {
            semanticStoppedText = visible.trim();
            request.onToken(semanticStoppedText, streamedTokenCount);
            this.requestNativeStop(context);
            return;
          }
          if (loopStoppedText === null && semanticStoppedText === null) {
            request.onToken(visible, streamedTokenCount);
          }
        }
      );
      if (prefillActive) {
        prefillActive = false;
        notifyRuntimeStage(request, 'prefill', 'completed');
      }
      if (generationActive) {
        generationActive = false;
        notifyRuntimeStage(request, 'generation', 'completed');
      }

      if (this.cancelRequested || request.signal.aborted) {
        this.status = 'loaded';
        throw new QwenGenerationCancelledError();
      }

      const text = loopStoppedText
        ?? semanticStoppedText
        ?? stripControlTags(result.content ?? result.text ?? cumulativeRaw).trim();
      const generatedTokens =
        result.tokens_predicted ?? result.timings?.predicted_n ?? streamedTokenCount;
      if (generatedTokens >= gracefulCompletionThreshold) {
        gracefulCompletionModeEntered = true;
      }
      const nativeFinishReason = resolveFinishReason(result, generatedTokens, generationLimit);
      const semanticCompletionReached =
        nativeFinishReason === 'length'
          ? hasStrongSemanticCompletionBoundary(text, taskKind)
          : assessSemanticCompletion(text, taskKind);
      const actualStopReason =
        loopStoppedText !== null
          ? 'loop-detected'
          : semanticStoppedText !== null
            ? 'semantic-completion'
            : nativeFinishReason === 'length'
              ? 'emergency-ceiling'
              : 'model-eos';
      const finishReason =
        loopStoppedText !== null
          ? 'looping'
          : nativeFinishReason === 'length' && !semanticCompletionReached
            ? 'length'
            : 'natural';
      this.status = 'loaded';
      return this.buildResult(
        text,
        result,
        startedAt,
        firstTokenAt,
        streamedTokenCount,
        generationLimit,
        inputShortenedWarning,
        samplingProfile,
        reconciled.estimatedPromptTokens,
        reconciled.finalNativePromptTokens,
        finishReason,
        {
          targetTokenBudget,
          emergencyHardCeilingTokens: generationLimit,
          semanticCompletionReached,
          gracefulCompletionModeEntered,
          actualStopReason,
          responseModeHardMaximum: getResponseGenerationLimit(request.responseMode),
          effectiveNativeGenerationLimit: generationLimit,
          softTargetTokens: targetTokenBudget,
          generationPlanId: request.generationPlanId ?? defaultPlanId(request.kind),
          taskKind,
          structuredOutputMode: usesStructuredExtraction(request.kind)
            ? 'native-json-schema'
            : 'not-used',
          structuredOutputSchemaVersion: usesStructuredExtraction(request.kind)
            ? STRUCTURED_VISUAL_EXTRACTION_SCHEMA_VERSION
            : null,
        },
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
      if (prefillActive) {
        notifyRuntimeStage(request, 'prefill', 'completed');
      }
      if (generationActive) {
        notifyRuntimeStage(request, 'generation', 'completed');
      }
      request.signal.removeEventListener('abort', onAbort);
    }
  }

  cancel(): void {
    if (this.status !== 'generating') {
      return;
    }
    this.cancelRequested = true;
    this.status = 'cancelling';
    const context = this.context;
    if (context !== null) {
      this.requestNativeStop(context);
    }
  }

  private requestNativeStop(context: LlamaContextLike): void {
    if (this.nativeStopRequested) {
      return;
    }
    this.nativeStopRequested = true;
    void safe(() => Promise.resolve(context.stopCompletion()));
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
    samplingProfile: SamplingProfile,
    estimatedPromptTokens: number,
    finalNativePromptTokens: number,
    forcedFinishReason?: GenerationFinishReason,
    generationDiagnostics?: GenerationRuntimeDiagnostics,
  ): QwenGenerateResult {
    const totalWallTimeMs = this.now() - startedAt;
    const timings = result.timings ?? {};
    const generatedTokens = result.tokens_predicted ?? timings.predicted_n ?? streamedTokenCount;
    const promptTokens =
      result.tokens_evaluated ?? timings.prompt_n ?? finalNativePromptTokens;
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
      estimatedPromptTokens,
      finalNativePromptTokens,
      promptTokens,
      generatedTokens,
      totalTokens: promptTokens + generatedTokens,
      tokensPerSecond,
      firstTokenLatencyMs,
      totalWallTimeMs,
      finishReason: forcedFinishReason
        ?? resolveFinishReason(result, generatedTokens, generationLimit),
      inputShortenedWarning,
      samplingProfile,
      generationDiagnostics: generationDiagnostics ?? {
        targetTokenBudget: Math.max(1, generationLimit - 128),
        emergencyHardCeilingTokens: generationLimit,
        semanticCompletionReached: assessSemanticCompletion(text, 'concise-prose'),
        gracefulCompletionModeEntered: false,
        actualStopReason:
          resolveFinishReason(result, generatedTokens, generationLimit) === 'length'
            ? 'emergency-ceiling'
            : 'model-eos',
        responseModeHardMaximum: generationLimit,
        effectiveNativeGenerationLimit: generationLimit,
        softTargetTokens: Math.max(1, generationLimit - 128),
        generationPlanId: 'response-mode-default-v1',
        taskKind: 'concise-prose',
      },
    };
  }
}

function notifyRuntimeStage(
  request: QwenGenerateRequest,
  stage: GenerationRuntimeStageEvent['stage'],
  status: GenerationRuntimeStageEvent['status'],
): void {
  const nativeSchemaActive =
    usesStructuredExtraction(request.kind)
    && (stage === 'prefill' || stage === 'generation');
  request.onRuntimeStage?.({
    stage,
    status,
    ...(nativeSchemaActive
      ? {
          structuredOutputMode: 'native-json-schema',
          structuredOutputSchemaVersion: STRUCTURED_VISUAL_EXTRACTION_SCHEMA_VERSION,
        } as const
      : {}),
  });
}

function resolveGracefulCompletionReserve(
  generationLimit: number,
  requestedReserve: number | undefined,
): number {
  const defaultReserve = Math.min(128, Math.max(16, Math.floor(generationLimit / 8)));
  return Math.max(
    0,
    Math.min(generationLimit - 1, requestedReserve ?? defaultReserve),
  );
}

function isGracefulRuntimeStopEligible(
  kind: QwenGenerateRequest['kind'],
  taskKind: import('../GenerationTuning').GenerationTaskKind,
): boolean {
  if (kind === 'extraction' || kind === 'extractionRetry' || kind === 'compaction') {
    return false;
  }
  return (
    taskKind === 'concise-prose'
    || taskKind === 'visual-description'
    || taskKind === 'structured-extraction'
  );
}

function hasStrongSemanticCompletionBoundary(
  text: string,
  taskKind: import('../GenerationTuning').GenerationTaskKind,
): boolean {
  const trimmed = text.trim();
  if (!hasBalancedStructure(trimmed, taskKind)) {
    return false;
  }
  return (
    /[.!?…](?:["')\]]+)?$/.test(trimmed)
    || /```$/.test(trimmed)
    || (
      (taskKind === 'structured-extraction' || taskKind === 'coding')
      && /[}\]]$/.test(trimmed)
    )
  );
}

function assessSemanticCompletion(
  text: string,
  taskKind: import('../GenerationTuning').GenerationTaskKind,
): boolean {
  const trimmed = text.trim();
  if (trimmed === '' || !hasBalancedStructure(trimmed, taskKind)) {
    return false;
  }
  if (hasStrongSemanticCompletionBoundary(trimmed, taskKind)) {
    return true;
  }
  if (/\b(?:and|or|because|with|to|the|a|an|of|for|that|which)\s*$/i.test(trimmed)) {
    return false;
  }
  if (/[,;:=-]\s*$/.test(trimmed)) {
    return false;
  }
  const words = trimmed.split(/\s+/);
  return taskKind === 'concise-prose' && words.length <= 12;
}

function hasBalancedStructure(
  text: string,
  taskKind: import('../GenerationTuning').GenerationTaskKind,
): boolean {
  const fenceCount = (text.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 !== 0) {
    return false;
  }
  if (
    taskKind !== 'coding'
    && taskKind !== 'structured-extraction'
    && !/^\s*(?:\{|\[)/.test(text)
  ) {
    return true;
  }

  const expectedClosers: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== null) {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    const apostropheInsideWord =
      character === "'"
      && /[A-Za-z0-9]/.test(text[index - 1] ?? '')
      && /[A-Za-z0-9]/.test(text[index + 1] ?? '');
    if ((character === '"' || character === "'") && !apostropheInsideWord) {
      quote = character;
      continue;
    }
    if (character === '{') expectedClosers.push('}');
    if (character === '[') expectedClosers.push(']');
    if (taskKind === 'coding' && character === '(') expectedClosers.push(')');
    if (character === '}' || character === ']' || character === ')') {
      if (expectedClosers.pop() !== character) {
        return false;
      }
    }
  }
  return quote === null && expectedClosers.length === 0;
}

function defaultTaskKind(
  kind: QwenGenerateRequest['kind'],
): import('../GenerationTuning').GenerationTaskKind {
  return kind === 'extraction' || kind === 'extractionRetry' || kind === 'compaction'
    ? 'structured-extraction'
    : 'concise-prose';
}

function defaultPlanId(kind: QwenGenerateRequest['kind']): string {
  return defaultTaskKind(kind) === 'structured-extraction'
    ? 'runtime-structured-extraction-v1'
    : 'response-mode-default-v1';
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
