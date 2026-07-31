// Enforces constitution Principles II (single-flight), IV (memory-safe
// preprocessing before any tensor code), and III (OOM never crashes). This
// module has ZERO imports from src/screens/ or UI/networking primitives.

import { createActor, fromPromise, type ActorRefFrom } from 'xstate';

import type { InferenceReadiness } from '../model/InferenceReadiness';
import type { IInferenceQueue } from '../types/interfaces';
import type {
  CanonicalConversationContext,
  InferenceRequest,
  InferenceEvidenceState,
  InferenceExecutionDiagnostics,
  InferenceState,
  InferenceStatus,
} from '../types/models';

import { postProcessAnswer } from './AnswerPostProcessor';
import { buildAnswerPrompt } from './AnswerPrompt';
import {
  buildCanonicalModelMessages,
  buildDirectImageModelMessages,
  buildPerceptionModelMessages,
  buildPerceptionRetryModelMessages,
  createCanonicalConversationContext,
  type ModelRequestMessage,
} from './ContextBuilder';
import type { DeviceResourcePolicy, ResourceLease } from './DeviceResourcePolicy';
import { parseExtractionWithRetry } from './ExtractionParser';
import { buildStructuredExtractionPrompt, requiresStructuredVision } from './ExtractionPrompt';
import {
  CURRENT_GENERATION_CONFIG_ID,
  CURRENT_PIPELINE_VARIANT_ID,
  LOOPING_ANSWER_NOTICE,
  createStructuredVisionGenerationPlan,
  samplingProfileForRequestKind,
  TRUNCATED_ANSWER_NOTICE,
} from './GenerationTuning';
import { prepareImageForInference } from './ImageEnhancer';
import { type PreprocessedImage } from './ImagePreprocessor';
import { inferenceActivityLock, type ActivityLock } from './InferenceActivityLock';
import type {
  EngineGenerateRequest,
  EngineGenerateResult,
  InferenceEngineAdapter,
} from './InferenceEngineHandle';
import { InferenceMetricsRecorder } from './InferenceMetrics';
import {
  createInferenceTrace,
  isDevelopmentInferenceTraceEnabled,
  type InferenceTrace,
  type InferenceTraceStageKind,
} from './InferenceTrace';
import type { ObjectiveInferenceResultRecord } from './ObjectiveInferenceResultRecord';
import { DEFAULT_RESPONSE_MODE, getResponseModeConfig, type ResponseMode } from './ResponseMode';
import {
  buildToolRefusalRecoveryMessages,
  shouldRetryToolRefusal,
} from './ToolRefusalRecovery';
import {
  turnLifecycleMachine,
  type PerceptionOutput,
  type StreamOutput,
  type TurnLifecycleRequest,
} from './turnLifecycleMachine';

export type {
  EngineGenerateRequest,
  EngineGenerateResult,
  InferenceEngineAdapter,
} from './InferenceEngineHandle';

export interface InferenceSubmitOptions {
  turn?: 'first' | 'followUp';
  conversationContext?: CanonicalConversationContext;
  /** Captured from the conversation immediately before submit/retry. */
  responseMode?: ResponseMode;
}

function generationConfigForRequest(
  responseMode: ResponseMode,
  request: InferenceRequest,
): ReturnType<typeof getResponseModeConfig> {
  const config = getResponseModeConfig(responseMode);
  return request.softTargetTokens === undefined
    ? config
    : { ...config, answerTargetTokens: request.softTargetTokens };
}

export interface InferenceQueueDeps {
  preprocess: (imagePath: string) => Promise<PreprocessedImage>;
  cleanupProcessedImage?: (processedPath: string, sourcePath: string) => Promise<void>;
  isReadyForInference: (requiresVision: boolean) => boolean;
  getInferenceReadiness?: (requiresVision: boolean) => InferenceReadiness;
  engine: InferenceEngineAdapter;
  getResponseMode?: () => ResponseMode;
  createRecorder?: () => InferenceMetricsRecorder;
  activityLock?: ActivityLock;
  resourcePolicy?: DeviceResourcePolicy;
  getDeviceBuildMetadata?: () => DeviceBuildMetadata;
  isTraceEnabled?: () => boolean;
  getModelAttribution?: () => {
    /** Aggregate model id used for diagnostics attribution. */
    modelId: string;
    generationConfigId: string;
  };
}

export interface DeviceBuildMetadata {
  deviceNameModel: string;
  appBuildId: string;
}

// 'cancelling' is in-flight: a stop was requested but the native call/lease have
// not settled, so no new generation may begin until it clears to 'idle'.
const IN_FLIGHT: ReadonlyArray<InferenceStatus> = [
  'preprocessing',
  'loading_model',
  'streaming',
  'cancelling',
];

const IDLE_STATE: InferenceState = {
  status: 'idle',
  response: '',
  metrics: null,
  error: null,
  limitWarning: null,
  finishReason: null,
  pinnedExtraction: null,
  hiddenEvidence: null,
  objectiveResult: null,
  inferenceTrace: null,
  executionDiagnostics: null,
};

interface ActiveRequest {
  readonly controller: AbortController;
  readonly trace: InferenceTrace | null;
  readonly recorder: InferenceMetricsRecorder;
  readonly attribution: {
    readonly modelId: string;
    readonly generationConfigId: string;
    readonly deviceNameModel: string;
    readonly appBuildId: string;
  };
  cancelled: boolean;
  evidenceState: InferenceEvidenceState;
  cancellationDiagnostics: InferenceExecutionDiagnostics | null;
}

interface LifecycleGate<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
}

interface LifecycleGates {
  readonly prepare: LifecycleGate<undefined>;
  readonly perception: LifecycleGate<PerceptionOutput>;
  readonly contextAssembly: LifecycleGate<undefined>;
  readonly loadModel: LifecycleGate<undefined>;
  readonly stream: LifecycleGate<StreamOutput>;
}

export class InferenceQueue implements IInferenceQueue {
  private state: InferenceState = { ...IDLE_STATE };
  private readonly listeners = new Set<(state: InferenceState) => void>();
  private readonly lifecycleActor: ActorRefFrom<typeof turnLifecycleMachine>;
  private active: ActiveRequest | null = null;
  private lifecycleGates: LifecycleGates | null = null;
  private lifecycleRequestSequence = 0;
  private readonly createRecorder: () => InferenceMetricsRecorder;
  private readonly activityLock: ActivityLock;
  private readonly resourcePolicy: DeviceResourcePolicy | null;

  constructor(private readonly deps: InferenceQueueDeps) {
    this.createRecorder = deps.createRecorder ?? (() => new InferenceMetricsRecorder());
    this.activityLock = deps.activityLock ?? inferenceActivityLock;
    this.resourcePolicy = deps.resourcePolicy ?? null;
    this.lifecycleActor = createActor(
      turnLifecycleMachine.provide({
        actors: {
          prepareTurn: fromPromise(() => this.requireLifecycleGates().prepare.promise),
          runPerception: fromPromise(() => this.requireLifecycleGates().perception.promise),
          assembleContext: fromPromise(() => this.requireLifecycleGates().contextAssembly.promise),
          loadModel: fromPromise(() => this.requireLifecycleGates().loadModel.promise),
          streamAnswer: fromPromise(() => this.requireLifecycleGates().stream.promise),
        },
      }),
    ).start();
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

  async submit(request: InferenceRequest, options: InferenceSubmitOptions = {}): Promise<void> {
    if (this.isInFlight()) {
      return Promise.reject(new Error('An inference is already in progress.'));
    }
    validatePlannedVisionRequest(request);

    const conversationContext = resolveConversationContext(options);

    const resourceLease: ResourceLease | null = this.resourcePolicy?.tryAcquire('qwen-answer') ?? null;
    const acquiredLegacyLock = this.resourcePolicy === null && this.activityLock.tryAcquire('vlm');
    if ((this.resourcePolicy !== null && resourceLease === null) ||
        (this.resourcePolicy === null && !acquiredLegacyLock)) {
      return Promise.reject(
        new Error(
          this.resourcePolicy === null
            ? 'Voice input is in progress. Stop it before starting inference.'
            : 'Another on-device operation is in progress. Try again in a moment.',
        ),
      );
    }

    const lifecycleRequest = this.createLifecycleRequest(request, options);
    const recorder = this.createRecorder();
    recorder.markRequestStart();
    const traceEnabled = this.deps.isTraceEnabled?.() ?? isDevelopmentInferenceTraceEnabled();
    const trace = traceEnabled ? this.stampTraceAttribution(createInferenceTrace(), lifecycleRequest) : null;
    const metadata = this.resolveDeviceBuildMetadata();
    const modelAttribution = this.deps.getModelAttribution?.() ?? {
      modelId: 'QWEN3_VL_2B_INSTRUCT_Q4_K_M',
      generationConfigId: 'qwen3-vl-2b-instruct-llamarn-v1',
    };
    const active: ActiveRequest = {
      controller: new AbortController(),
      trace,
      recorder,
      attribution: {
        ...modelAttribution,
        ...metadata,
      },
      cancelled: false,
      evidenceState: requestRequiresStructuredVision(request) ? 'pending' : 'not-applicable',
      cancellationDiagnostics: null,
    };
    this.active = active;
    const lifecycleGates = createLifecycleGates();
    this.lifecycleGates = lifecycleGates;
    this.lifecycleActor.send({
      type: 'SUBMIT',
      request: lifecycleRequest,
    });
    const responseMode = options.responseMode
      ?? this.deps.getResponseMode?.()
      ?? DEFAULT_RESPONSE_MODE;
    let processed: PreprocessedImage | null = null;

    this.setState({
      status: 'preprocessing',
      response: '',
      metrics: null,
      error: null,
      limitWarning: null,
      pinnedExtraction: null,
      hiddenEvidence: null,
      objectiveResult: null,
      inferenceTrace: trace,
      executionDiagnostics: this.buildExecutionDiagnostics(active),
    });

    try {
      recorder.markPreprocessingStart();
      recorder.startLatencyStage('image-preprocessing');
      const requestImagePath = this.resolveRequestImagePath(request, options);
      processed = requestImagePath === null
        ? null
        : await this.deps.preprocess(requestImagePath);
      lifecycleGates.prepare.resolve(undefined);
      recorder.markPreprocessingEnd();
      recorder.endLatencyStage('image-preprocessing');
      if (active.cancelled) return;

      const readiness = this.deps.getInferenceReadiness?.(processed !== null);
      if (readiness?.ready === false) {
        throw new Error(readiness.message);
      }
      if (readiness === undefined && !this.deps.isReadyForInference(processed !== null)) {
        throw new Error('Model setup needs attention before inference can start.');
      }

      this.setState({ status: 'loading_model' });
      recorder.markModelLoadStart();
      recorder.startLatencyStage('model-load');
      await this.deps.engine.loadModel();
      lifecycleGates.loadModel.resolve(undefined);
      recorder.markModelLoadEnd();
      recorder.endLatencyStage('model-load');
      if (active.cancelled) return;

      this.setState({ status: 'streaming' });
      recorder.markInferenceStart();

      const result =
        processed === null
          ? await this.generateFollowUpAnswer(
              request,
              conversationContext,
              responseMode,
              active,
              recorder,
              lifecycleGates,
            )
          : await this.generateFirstImageAnswer(
              request,
              processed,
              conversationContext,
              responseMode,
              active,
              recorder,
              lifecycleGates,
            );
      if (active.cancelled) return;

      recorder.setTokenCount(result.tokenCount);
      recorder.markAnswerEnd();
      recorder.markInferenceEnd();
      const processedAnswer = postProcessAnswer(result.response);
      if (result.hiddenEvidence !== null && result.hiddenEvidence !== undefined) {
        active.evidenceState = 'valid';
      }
      this.recordFinalTraceResponse(active, processedAnswer.text);
      const finishReason = resolveQualityFinishReason(
        result.finishReason ?? 'natural',
        processedAnswer.verdict,
      );
      const notice = resolveCompletionNotice(
        processedAnswer.verdict,
        finishReason,
        result.inputShortenedWarning ?? null,
      );
      this.setState({
        status: 'completed',
        response: processedAnswer.text,
        metrics: recorder.build(),
        limitWarning: notice,
        finishReason,
        pinnedExtraction: result.pinnedExtraction ?? null,
        hiddenEvidence: result.hiddenEvidence ?? null,
        objectiveResult: this.buildObjectiveResult(
          processedAnswer.text,
          finishReason === 'looping'
            ? 'looping'
            : finishReason === 'length'
              ? 'truncated'
              : 'complete',
          result,
          recorder,
          responseMode,
          request,
        ),
        inferenceTrace: active.trace,
        executionDiagnostics: this.buildExecutionDiagnostics(active),
      });
      lifecycleGates.stream.resolve({
        response: processedAnswer.text,
        tokenCount: result.tokenCount,
      });
    } catch (error) {
      if (active.cancelled) return;
      if (active.evidenceState === 'pending') {
        active.evidenceState = 'failed';
      }
      settleLifecycleGates(lifecycleGates);
      this.setState({
        status: 'errored',
        response: '',
        metrics: null,
        error: toMessage(error),
        limitWarning: null,
        finishReason: 'failed',
        pinnedExtraction: null,
        hiddenEvidence: null,
        objectiveResult: null,
        inferenceTrace: active.trace,
        executionDiagnostics: this.buildExecutionDiagnostics(active),
      });
    } finally {
      const wasCancelled = active.cancelled;
      if (this.active === active) {
        this.active = null;
      }
      if (this.lifecycleGates === lifecycleGates) {
        this.lifecycleGates = null;
      }
      if (processed !== null && request.imagePath !== null) {
        try {
          await this.deps.cleanupProcessedImage?.(processed.path, request.imagePath);
        } catch {
          // Temporary derivative cleanup is best-effort and never changes the turn result.
        }
      }
      // Release the device gate ONLY after the native call has truly settled, so
      // a queued/next generation cannot start while resources are still held.
      if (resourceLease !== null) {
        resourceLease.release();
      } else if (acquiredLegacyLock) {
        this.activityLock.release('vlm');
      }
      // Now that everything is released, publish the terminal cancelled→idle
      // transition. Skip it if the turn actually finished (completed/errored)
      // between the stop request and settling — that result stands.
      if (wasCancelled && this.state.status === 'cancelling') {
        this.emitCancellationTerminal(active);
      }
    }
  }

  /**
   * Requests cancellation. The queue enters 'cancelling' immediately (blocking any
   * new generation) and does not return to 'idle' until the in-flight native call
   * settles and its resource lease is released in `submit`'s finally block. This
   * closes the race where a stopped turn's lease was still held when the next
   * request began.
   */
  cancel(): void {
    const active = this.active;
    if (active === null || active.cancelled) return;

    active.cancelled = true;
    active.evidenceState =
      active.evidenceState === 'pending' ? 'cancelled' : active.evidenceState;
    active.cancellationDiagnostics = this.buildExecutionDiagnostics(active);
    active.controller.abort();
    this.lifecycleActor.send({ type: 'CANCEL' });
    if (this.lifecycleGates !== null) {
      settleLifecycleGates(this.lifecycleGates);
    }

    this.setState({
      status: 'cancelling',
      response: '',
      metrics: null,
      error: null,
      limitWarning: null,
      finishReason: 'cancelled',
      pinnedExtraction: null,
      hiddenEvidence: null,
      objectiveResult: null,
      inferenceTrace: active.trace,
      executionDiagnostics: active.cancellationDiagnostics,
    });
  }

  /** Publishes the observable terminal cancellation, then returns to idle. */
  private emitCancellationTerminal(active: ActiveRequest): void {
    this.setState({
      status: 'cancelled',
      response: '',
      metrics: null,
      error: null,
      limitWarning: null,
      finishReason: 'cancelled',
      pinnedExtraction: null,
      hiddenEvidence: null,
      objectiveResult: null,
      inferenceTrace: active.trace,
      executionDiagnostics:
        active.cancellationDiagnostics ?? this.buildExecutionDiagnostics(active),
    });
    this.setState({ ...IDLE_STATE });
  }

  private async generateFirstImageAnswer(
    request: InferenceRequest,
    processed: PreprocessedImage,
    conversationContext: CanonicalConversationContext,
    responseMode: ResponseMode,
    active: ActiveRequest,
    recorder: InferenceMetricsRecorder,
    lifecycleGates: LifecycleGates,
  ): Promise<EngineGenerateResult> {
    const plannedVisionStrategy = request.visionExecutionPlan?.strategy;
    const shouldStructure =
      plannedVisionStrategy === 'inspect-and-structure'
      || (
        plannedVisionStrategy === undefined
        && requiresStructuredVision(request.question)
      );
    if (!shouldStructure) {
      lifecycleGates.perception.resolve({ hiddenEvidence: null, pinnedExtraction: null });
      lifecycleGates.contextAssembly.resolve(undefined);
      return this.generateVisibleAnswer(
        buildDirectImageModelMessages(
          {
            conversationContext,
            currentQuestion: request.question,
            responseMode,
            responseModeConfig: generationConfigForRequest(responseMode, request),
          },
          processed.path,
        ),
        responseMode,
        active,
        recorder,
        { kind: 'answer', originalQuestion: request.question },
        request,
      );
    }

    recorder.markPerceptionStart();
    const extractionPlan = createStructuredVisionGenerationPlan('extraction');
    const extractionRequest: EngineGenerateRequest = {
      messages: buildPerceptionModelMessages(
        buildStructuredExtractionPrompt(request.question),
        processed.path
      ),
      kind: 'extraction',
      originalQuestion: request.question,
      responseMode,
      softTargetTokens: extractionPlan.softTargetTokens,
      hardSafetyLimitTokens: extractionPlan.hardSafetyLimitTokens,
      gracefulCompletionReserveTokens: extractionPlan.gracefulCompletionReserveTokens,
      generationPlanId: extractionPlan.diagnosticsId,
      generationTaskKind: extractionPlan.taskKind,
      loopDetectionEligible: false,
      onRuntimeStage: this.createRuntimeStageHandler(active, 'hidden'),
    };
    const extractionResult = await this.deps.engine.generate(
      extractionRequest,
      () => {
        // Hidden perception output never streams into visible queue state.
      },
      active.controller.signal,
    );
    recorder.markPerceptionEnd();
    if (active.cancelled) {
      return extractionResult;
    }

    recorder.startLatencyStage('evidence-validation');
    const extractionOutcome = await parseExtractionWithRetry(
      extractionResult.response,
      async (retryPrompt) => {
        const retryPlan = createStructuredVisionGenerationPlan('extractionRetry');
        const retryRequest: EngineGenerateRequest = {
          messages: buildPerceptionRetryModelMessages(retryPrompt),
          kind: 'extractionRetry',
          originalQuestion: request.question,
          responseMode,
          softTargetTokens: retryPlan.softTargetTokens,
          hardSafetyLimitTokens: retryPlan.hardSafetyLimitTokens,
          gracefulCompletionReserveTokens: retryPlan.gracefulCompletionReserveTokens,
          generationPlanId: retryPlan.diagnosticsId,
          generationTaskKind: retryPlan.taskKind,
          loopDetectionEligible: false,
          onRuntimeStage: this.createRuntimeStageHandler(active, 'hidden'),
        };
        const retryResult = await this.deps.engine.generate(
          retryRequest,
          () => {
            // Retry output is hidden for the same reason as first perception.
          },
          active.controller.signal,
        );
        this.recordTraceStage(active, 'extractionRetry', retryRequest, retryResult);
        return retryResult.response;
      },
      request.question,
      processed.path,
      { allowRetry: extractionResult.finishReason !== 'length' },
    );
    recorder.endLatencyStage('evidence-validation');
    active.evidenceState =
      extractionOutcome.hiddenEvidence === null ? 'failed' : 'valid-unpersisted';
    this.recordTraceStage(active, 'perception', extractionRequest, extractionResult, {
      parsedOutput: extractionOutcome.hiddenEvidence,
      processedOutput: extractionOutcome.visibleAnswer,
    });
    lifecycleGates.perception.resolve({
      hiddenEvidence: extractionOutcome.hiddenEvidence,
      pinnedExtraction: extractionOutcome.pinnedExtraction,
    });
    if (active.cancelled) {
      return extractionResult;
    }

    if (extractionOutcome.hiddenEvidence === null) {
      lifecycleGates.contextAssembly.resolve(undefined);
      recorder.markAnswerStart();
      recorder.startLatencyStage('visible-answer-startup');
      recorder.markFirstToken();
      recorder.markAnswerFirstToken();
      recorder.endLatencyStage('visible-answer-startup');
      this.setState({ response: extractionOutcome.visibleAnswer });
      return {
        response: extractionOutcome.visibleAnswer,
        tokenCount: extractionResult.tokenCount,
        pinnedExtraction: extractionOutcome.pinnedExtraction,
        hiddenEvidence: null,
      };
    }

    recorder.startLatencyStage('context-assembly');
    const answerPrompt = buildAnswerPrompt({
      question: request.question,
      hiddenEvidence: extractionOutcome.hiddenEvidence,
      conversationMode: 'live',
      generationConfigId: CURRENT_GENERATION_CONFIG_ID,
      pipelineVariantId: CURRENT_PIPELINE_VARIANT_ID,
    });
    lifecycleGates.contextAssembly.resolve(undefined);
    recorder.endLatencyStage('context-assembly');
    const answerResult = await this.generateVisibleAnswer(
      buildCanonicalModelMessages({
        conversationContext,
        currentQuestion: answerPrompt,
        responseMode,
        responseModeConfig: generationConfigForRequest(responseMode, request),
      }),
      responseMode,
      active,
      recorder,
      {
        kind: 'answer',
        originalQuestion: request.question,
      },
      request,
    );

    return {
      ...answerResult,
      pinnedExtraction: extractionOutcome.pinnedExtraction,
      hiddenEvidence: extractionOutcome.hiddenEvidence,
    };
  }

  private generateFollowUpAnswer(
    request: InferenceRequest,
    conversationContext: CanonicalConversationContext,
    responseMode: ResponseMode,
    active: ActiveRequest,
    recorder: InferenceMetricsRecorder,
    lifecycleGates: LifecycleGates,
  ): Promise<EngineGenerateResult> {
    lifecycleGates.perception.resolve({
      hiddenEvidence: null,
      pinnedExtraction: null,
    });
    lifecycleGates.contextAssembly.resolve(undefined);
    return this.generateVisibleAnswer(
      buildCanonicalModelMessages({
        conversationContext,
        currentQuestion: request.question,
        responseMode,
        responseModeConfig: generationConfigForRequest(responseMode, request),
      }),
      responseMode,
      active,
      recorder,
      {
        kind: 'chat',
        originalQuestion: request.question,
      },
      request,
    );
  }

  private async generateVisibleAnswer(
    messages: ModelRequestMessage[],
    responseMode: ResponseMode,
    active: ActiveRequest,
    recorder: InferenceMetricsRecorder,
    requestPatch: Partial<EngineGenerateRequest> = {},
    inferenceRequest?: InferenceRequest,
  ): Promise<EngineGenerateResult> {
    recorder.markAnswerStart();
    recorder.startLatencyStage('visible-answer-startup');
    const generateRequest: EngineGenerateRequest = {
      messages,
      responseMode,
      ...requestPatch,
      softTargetTokens: inferenceRequest?.softTargetTokens,
      hardSafetyLimitTokens: inferenceRequest?.hardSafetyLimitTokens,
      gracefulCompletionReserveTokens: inferenceRequest?.gracefulCompletionReserveTokens,
      generationPlanId: inferenceRequest?.generationPlanId,
      generationTaskKind: inferenceRequest?.generationTaskKind,
      loopDetectionEligible: inferenceRequest?.loopDetectionEligible,
      onRuntimeStage: this.createRuntimeStageHandler(active, 'visible'),
    };
    const stage: InferenceTraceStageKind =
      generateRequest.kind === 'chat' ? 'followUp' : 'answer';

    const onToken = (cumulative: string, generatedTokenCount?: number): void => {
      if (active.cancelled) return;
      recorder.markFirstToken();
      recorder.markAnswerFirstToken();
      recorder.endLatencyStage('visible-answer-startup');
      this.lifecycleActor.send({
        type: 'TOKEN',
        response: cumulative,
        count: generatedTokenCount ?? 0,
      });
      this.setState({ response: cumulative });
    };

    const result = await this.deps.engine.generate(
      generateRequest,
      onToken,
      active.controller.signal,
    );
    recorder.endLatencyStage('visible-answer-startup');
    this.recordVisibleTraceStage(active, stage, generateRequest, result);

    const originalQuestion = generateRequest.originalQuestion ?? '';
    if (
      active.cancelled ||
      active.controller.signal.aborted ||
      !shouldRetryToolRefusal(result.response, originalQuestion)
    ) {
      return result;
    }

    const retryRequest: EngineGenerateRequest = {
      ...generateRequest,
      messages: buildToolRefusalRecoveryMessages(messages),
    };
    const retryResult = await this.deps.engine.generate(
      retryRequest,
      onToken,
      active.controller.signal,
    );
    this.recordVisibleTraceStage(active, stage, retryRequest, retryResult, { refusalRetry: true });
    return retryResult;
  }

  private recordVisibleTraceStage(
    active: ActiveRequest,
    stage: InferenceTraceStageKind,
    request: EngineGenerateRequest,
    result: EngineGenerateResult,
    options: { refusalRetry?: boolean } = {},
  ): void {
    const processed = postProcessAnswer(result.response);
    this.recordTraceStage(active, stage, request, result, {
      processedOutput: processed.text,
      refusalRetry: options.refusalRetry,
    });
  }

  private buildObjectiveResult(
    answerText: string,
    verdict: 'complete' | 'truncated' | 'looping',
    result: EngineGenerateResult,
    recorder: InferenceMetricsRecorder,
    responseMode: ResponseMode,
    request: InferenceRequest,
  ): ObjectiveInferenceResultRecord {
    const timings = recorder.buildObjectiveTimings();
    const metadata = this.resolveDeviceBuildMetadata();
    const record: ObjectiveInferenceResultRecord = {
      answerText,
      ...timings,
      generatedTokens: result.tokenCount,
      truncated: verdict === 'truncated',
      looping: verdict === 'looping',
      timestamp: new Date().toISOString(),
      ...(this.deps.getModelAttribution?.() ?? {
        modelId: 'QWEN3_VL_2B_INSTRUCT_Q4_K_M',
        generationConfigId: 'qwen3-vl-2b-instruct-llamarn-v1',
      }),
      pipelineVariantId: CURRENT_PIPELINE_VARIANT_ID,
      deviceNameModel: metadata.deviceNameModel,
      appBuildId: metadata.appBuildId,
      responseMode,
      targetTokenBudget:
        result.generationDiagnostics?.targetTokenBudget
        ?? result.generationDiagnostics?.softTargetTokens
        ?? request.softTargetTokens
        ?? getResponseModeConfig(responseMode).answerTargetTokens,
      emergencyHardCeilingTokens:
        result.generationDiagnostics?.emergencyHardCeilingTokens
        ?? result.generationDiagnostics?.effectiveNativeGenerationLimit
        ?? request.hardSafetyLimitTokens
        ?? getResponseModeConfig(responseMode).generationLimit,
      semanticCompletionReached:
        result.generationDiagnostics?.semanticCompletionReached
        ?? postProcessAnswer(answerText).verdict === 'complete',
      gracefulCompletionModeEntered:
        result.generationDiagnostics?.gracefulCompletionModeEntered
        ?? false,
      actualStopReason:
        result.generationDiagnostics?.actualStopReason
        ?? actualStopReasonForFinishReason(
          verdict === 'truncated' ? 'length' : verdict === 'looping' ? 'looping' : 'natural',
        ),
      targetTokenCount:
        result.generationDiagnostics?.softTargetTokens
        ?? request.softTargetTokens
        ?? getResponseModeConfig(responseMode).answerTargetTokens,
      generationLimit:
        result.generationDiagnostics?.effectiveNativeGenerationLimit
        ?? request.hardSafetyLimitTokens
        ?? getResponseModeConfig(responseMode).generationLimit,
      softTargetTokens:
        result.generationDiagnostics?.softTargetTokens
        ?? request.softTargetTokens
        ?? getResponseModeConfig(responseMode).answerTargetTokens,
      responseModeHardMaximum:
        result.generationDiagnostics?.responseModeHardMaximum
        ?? getResponseModeConfig(responseMode).generationLimit,
      effectiveNativeGenerationLimit:
        result.generationDiagnostics?.effectiveNativeGenerationLimit
        ?? request.hardSafetyLimitTokens
        ?? getResponseModeConfig(responseMode).generationLimit,
      generationPlanId:
        result.generationDiagnostics?.generationPlanId
        ?? request.generationPlanId
        ?? 'response-mode-default-v1',
      generationTaskKind:
        result.generationDiagnostics?.taskKind
        ?? request.generationTaskKind
        ?? 'concise-prose',
      samplingProfile:
        result.samplingProfile ?? samplingProfileForRequestKind('answer'),
    };
    if (result.promptTokenCount !== undefined) {
      record.promptTokens = result.promptTokenCount;
    }
    if (result.estimatedPromptTokenCount !== undefined) {
      record.estimatedPromptTokens = result.estimatedPromptTokenCount;
    }
    if (result.finalNativePromptTokenCount !== undefined) {
      record.finalNativePromptTokens = result.finalNativePromptTokenCount;
    }
    return record;
  }

  private recordTraceStage(
    active: ActiveRequest,
    stage: InferenceTraceStageKind,
    request: EngineGenerateRequest,
    result: EngineGenerateResult,
    parsed: { parsedOutput?: unknown; processedOutput?: string; refusalRetry?: boolean } = {}
  ): void {
    if (active.trace === null) {
      return;
    }

    active.trace.stages.push({
      stage,
      modelInput: request.messages,
      rawOutput: result.response,
      generationDiagnostics: result.generationDiagnostics ?? {
        targetTokenBudget:
          request.softTargetTokens
          ?? getResponseModeConfig(request.responseMode).answerTargetTokens,
        emergencyHardCeilingTokens:
          request.hardSafetyLimitTokens
          ?? getResponseModeConfig(request.responseMode).generationLimit,
        semanticCompletionReached: postProcessAnswer(result.response).verdict === 'complete',
        gracefulCompletionModeEntered: false,
        actualStopReason: 'model-eos',
        responseModeHardMaximum: getResponseModeConfig(request.responseMode).generationLimit,
        effectiveNativeGenerationLimit:
          request.hardSafetyLimitTokens
          ?? getResponseModeConfig(request.responseMode).generationLimit,
        softTargetTokens:
          request.softTargetTokens
          ?? getResponseModeConfig(request.responseMode).answerTargetTokens,
        generationPlanId: request.generationPlanId ?? 'response-mode-default-v1',
        taskKind: request.generationTaskKind ?? 'concise-prose',
      },
      ...parsed,
    });
    this.setState({ inferenceTrace: active.trace });
  }

  private recordFinalTraceResponse(active: ActiveRequest, finalResponse: string): void {
    if (active.trace === null) {
      return;
    }

    active.trace.finalResponse = finalResponse;
    this.setState({ inferenceTrace: active.trace });
  }

  private resolveDeviceBuildMetadata(): DeviceBuildMetadata {
    return this.deps.getDeviceBuildMetadata?.() ?? {
      deviceNameModel: 'unknown-device',
      appBuildId: 'unknown-build',
    };
  }

  private createRuntimeStageHandler(
    active: ActiveRequest,
    generation: 'hidden' | 'visible',
  ): NonNullable<EngineGenerateRequest['onRuntimeStage']> {
    return (event): void => {
      const stage = latencyStageForRuntimeEvent(event.stage, generation);
      if (event.status === 'started') {
        active.recorder.startLatencyStage(stage);
      } else {
        active.recorder.endLatencyStage(stage);
      }
    };
  }

  private buildExecutionDiagnostics(
    active: ActiveRequest,
  ): InferenceExecutionDiagnostics {
    return {
      ...active.recorder.captureExecutionTimings(),
      evidenceState: active.evidenceState,
      modelId: active.attribution.modelId,
      generationConfigId: active.attribution.generationConfigId,
      pipelineVariantId: CURRENT_PIPELINE_VARIANT_ID,
      deviceNameModel: active.attribution.deviceNameModel,
      appBuildId: active.attribution.appBuildId,
    };
  }

  private isInFlight(): boolean {
    return IN_FLIGHT.includes(this.state.status);
  }

  private createLifecycleRequest(
    request: InferenceRequest,
    options: InferenceSubmitOptions,
  ): TurnLifecycleRequest {
    const requestWithAttribution = request as InferenceRequest & Partial<TurnLifecycleRequest>;
    const fallbackRequestId = this.createFallbackLifecycleId('request');
    const imagePath = this.resolveRequestImagePath(request, options);

    return {
      requestId: requestWithAttribution.requestId ?? fallbackRequestId,
      conversationId: requestWithAttribution.conversationId ?? this.createFallbackLifecycleId('conversation'),
      originatingUserMessageId:
        requestWithAttribution.originatingUserMessageId ??
        this.createFallbackLifecycleId('user-message'),
      assistantMessageId:
        requestWithAttribution.assistantMessageId ??
        this.createFallbackLifecycleId('assistant-message'),
      question: request.question,
      imagePath,
    };
  }

  private stampTraceAttribution(
    trace: InferenceTrace,
    lifecycleRequest: TurnLifecycleRequest,
  ): InferenceTrace {
    trace.conversationId = lifecycleRequest.conversationId;
    trace.originatingUserMessageId = lifecycleRequest.originatingUserMessageId;
    trace.assistantMessageId = lifecycleRequest.assistantMessageId;
    return trace;
  }

  private createFallbackLifecycleId(prefix: string): string {
    this.lifecycleRequestSequence += 1;
    return `legacy-${prefix}-${this.lifecycleRequestSequence}`;
  }

  private resolveRequestImagePath(
    request: InferenceRequest,
    options: InferenceSubmitOptions,
  ): string | null {
    const strategy = request.visionExecutionPlan?.strategy;
    if (
      strategy === 'none'
      || strategy === 'reuse-evidence'
      || strategy === 'compare-evidence'
    ) {
      return null;
    }
    if (request.imagePath === null) {
      return null;
    }

    if (options.turn !== 'followUp') {
      return request.imagePath;
    }

    return hasStableAttribution(request) ? request.imagePath : null;
  }

  private requireLifecycleGates(): LifecycleGates {
    if (this.lifecycleGates === null) {
      throw new Error('No active lifecycle request.');
    }

    return this.lifecycleGates;
  }

  private setState(patch: Partial<InferenceState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

function latencyStageForRuntimeEvent(
  stage: import('./InferenceEngineHandle').GenerationRuntimeStage,
  generation: 'hidden' | 'visible',
): import('./InferenceMetrics').InferenceLatencyStage {
  if (stage === 'generation') {
    return generation === 'hidden' ? 'hidden-generation' : 'visible-generation';
  }
  const phase = generation === 'hidden' ? 'extraction' : 'visible-answer';
  if (stage === 'prompt-formatting') return `${phase}-formatting`;
  return `${phase}-${stage}`;
}

function validatePlannedVisionRequest(request: InferenceRequest): void {
  const strategy = request.visionExecutionPlan?.strategy;
  if (
    (strategy === 'inspect-original' || strategy === 'inspect-and-structure')
    && request.imagePath === null
  ) {
    throw new Error('The validated vision plan requires an available image asset.');
  }
}

function requestRequiresStructuredVision(request: InferenceRequest): boolean {
  const strategy = request.visionExecutionPlan?.strategy;
  return strategy === 'inspect-and-structure'
    || (strategy === undefined && requiresStructuredVision(request.question));
}

export function createInferenceQueue(
  engine: InferenceEngineAdapter,
  overrides: Partial<InferenceQueueDeps> = {},
): InferenceQueue {
  return new InferenceQueue({
    preprocess: prepareImageForInference,
    cleanupProcessedImage: async () => undefined,
    isReadyForInference: () => false,
    getModelAttribution: () => ({
      modelId: 'QWEN3_VL_2B_INSTRUCT_Q4_K_M',
      generationConfigId: 'qwen3-vl-2b-instruct-llamarn-v1',
    }),
    engine,
    ...overrides,
  });
}

function resolveCompletionNotice(
  verdict: 'complete' | 'truncated' | 'looping',
  finishReason: 'natural' | 'length' | 'looping' | 'cancelled' | 'failed',
  inputShortenedWarning: string | null,
): string | null {
  // Only an incomplete emergency-ceiling stop is truncation. Tail-shape
  // heuristics remain useful for assessment but cannot override a natural stop.
  const answerNotice =
    finishReason === 'length'
      ? TRUNCATED_ANSWER_NOTICE
      : finishReason === 'looping' || verdict === 'looping'
        ? LOOPING_ANSWER_NOTICE
        : null;
  return [inputShortenedWarning, answerNotice].filter((notice) => notice !== null).join(' ') || null;
}

function resolveQualityFinishReason(
  runtimeReason: 'natural' | 'length' | 'looping' | 'cancelled' | 'failed',
  verdict: 'complete' | 'truncated' | 'looping',
): 'natural' | 'length' | 'looping' | 'cancelled' | 'failed' {
  if (verdict === 'looping' || runtimeReason === 'looping') {
    return 'looping';
  }
  return runtimeReason;
}

function actualStopReasonForFinishReason(
  finishReason: 'natural' | 'length' | 'looping' | 'cancelled' | 'failed',
): import('./GenerationTuning').GenerationActualStopReason {
  if (finishReason === 'length') return 'emergency-ceiling';
  if (finishReason === 'looping') return 'loop-detected';
  if (finishReason === 'cancelled') return 'cancelled';
  if (finishReason === 'failed') return 'failed';
  return 'model-eos';
}

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return 'Inference failed for an unknown reason.';
}

function hasStableAttribution(request: InferenceRequest): boolean {
  return (
    typeof request.requestId === 'string' &&
    typeof request.conversationId === 'string' &&
    typeof request.originatingUserMessageId === 'string' &&
    typeof request.assistantMessageId === 'string'
  );
}

function resolveConversationContext(
  options: InferenceSubmitOptions,
): CanonicalConversationContext {
  if (options.turn === 'followUp' && options.conversationContext === undefined) {
    throw new Error('A follow-up inference requires canonical conversation context.');
  }

  const context = options.conversationContext ?? createCanonicalConversationContext([]);
  return {
    ...context,
    recentTurns: context.recentTurns.map((turn) => ({ ...turn })),
    mediaEvidence: context.mediaEvidence.map((evidence) => ({
      ...evidence,
      facts: [...evidence.facts],
      extractedText: [...evidence.extractedText],
      uncertainty: [...evidence.uncertainty],
    })),
    importantFacts: context.importantFacts.map((fact) => ({ ...fact })),
    budget: { ...context.budget },
  };
}

function createLifecycleGates(): LifecycleGates {
  return {
    prepare: createLifecycleGate<undefined>(),
    perception: createLifecycleGate<PerceptionOutput>(),
    contextAssembly: createLifecycleGate<undefined>(),
    loadModel: createLifecycleGate<undefined>(),
    stream: createLifecycleGate<StreamOutput>(),
  };
}

function createLifecycleGate<T>(): LifecycleGate<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function settleLifecycleGates(gates: LifecycleGates): void {
  gates.prepare.resolve(undefined);
  gates.perception.resolve({
    hiddenEvidence: null,
    pinnedExtraction: null,
  });
  gates.contextAssembly.resolve(undefined);
  gates.loadModel.resolve(undefined);
  gates.stream.resolve({
    response: '',
    tokenCount: 0,
  });
}
