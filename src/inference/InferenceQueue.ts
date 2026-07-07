// Enforces constitution Principles II (single-flight), IV (memory-safe
// preprocessing before any tensor code), and III (OOM never crashes). This
// module has ZERO imports from src/screens/ or UI/networking primitives.

import type { IInferenceQueue } from '../types/interfaces';
import type { InferenceRequest, InferenceState, InferenceStatus } from '../types/models';

import { postProcessAnswer } from './AnswerPostProcessor';
import { buildAnswerPrompt } from './AnswerPrompt';
import { parseExtractionWithRetry } from './ExtractionParser';
import { buildStructuredExtractionPrompt } from './ExtractionPrompt';
import { getResponseLimitWarning } from './GenerationLimits';
import {
  CURRENT_GENERATION_CONFIG_ID,
  CURRENT_PIPELINE_VARIANT_ID,
  LOOPING_ANSWER_NOTICE,
  OUTPUT_LIMIT_NOTICE,
  OUTPUT_TOKEN_BUDGET,
  TRUNCATED_ANSWER_NOTICE,
} from './GenerationTuning';
import { prepareImageForInference } from './ImageEnhancer';
import { type PreprocessedImage } from './ImagePreprocessor';
import { inferenceActivityLock, type ActivityLock } from './InferenceActivityLock';
import { InferenceMetricsRecorder } from './InferenceMetrics';
import type { ObjectiveInferenceResultRecord } from './ObjectiveInferenceResultRecord';

export interface EngineGenerateRequest {
  question: string;
  imagePath?: string;
  kind?: 'extraction' | 'extractionRetry' | 'answer' | 'chat';
  originalQuestion?: string;
}

export interface EngineGenerateResult {
  response: string;
  tokenCount: number;
  promptTokenCount?: number;
  totalTokenCount?: number;
  pinnedExtraction?: string | null;
  hiddenEvidence?: InferenceState['hiddenEvidence'];
}

export interface InferenceEngineAdapter {
  loadModel(): Promise<void>;
  generate(
    request: EngineGenerateRequest,
    onToken: (cumulativeResponse: string, generatedTokenCount?: number) => void,
    signal: AbortSignal,
  ): Promise<EngineGenerateResult>;
}

export interface InferenceSubmitOptions {
  turn?: 'first' | 'followUp';
}

export interface InferenceQueueDeps {
  preprocess: (imagePath: string) => Promise<PreprocessedImage>;
  isReadyForInference: () => boolean;
  engine: InferenceEngineAdapter;
  createRecorder?: () => InferenceMetricsRecorder;
  activityLock?: ActivityLock;
  getDeviceBuildMetadata?: () => DeviceBuildMetadata;
}

export interface DeviceBuildMetadata {
  deviceNameModel: string;
  appBuildId: string;
}

const IN_FLIGHT: ReadonlyArray<InferenceStatus> = ['preprocessing', 'loading_model', 'streaming'];

const IDLE_STATE: InferenceState = {
  status: 'idle',
  response: '',
  metrics: null,
  error: null,
  limitWarning: null,
  pinnedExtraction: null,
  hiddenEvidence: null,
  objectiveResult: null,
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
  private readonly activityLock: ActivityLock;

  constructor(private readonly deps: InferenceQueueDeps) {
    this.createRecorder = deps.createRecorder ?? (() => new InferenceMetricsRecorder());
    this.activityLock = deps.activityLock ?? inferenceActivityLock;
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

    if (!this.activityLock.tryAcquire('vlm')) {
      return Promise.reject(
        new Error('Voice input is in progress. Try again in a moment.'),
      );
    }

    const active: ActiveRequest = { controller: new AbortController(), cancelled: false };
    this.active = active;
    const recorder = this.createRecorder();
    const isFollowUp = options.turn === 'followUp';

    this.setState({
      status: 'preprocessing',
      response: '',
      metrics: null,
      error: null,
      limitWarning: null,
      pinnedExtraction: null,
      hiddenEvidence: null,
      objectiveResult: null,
    });

    try {
      recorder.markRequestStart();
      recorder.markPreprocessingStart();
      const processed = isFollowUp
        ? null
        : await this.deps.preprocess(request.imagePath);
      recorder.markPreprocessingEnd();
      if (active.cancelled) return;

      if (!this.deps.isReadyForInference()) {
        throw new Error('The model is not downloaded and verified yet.');
      }

      this.setState({ status: 'loading_model' });
      recorder.markModelLoadStart();
      if (!isFollowUp) {
        await this.deps.engine.loadModel();
      }
      recorder.markModelLoadEnd();
      if (active.cancelled) return;

      this.setState({ status: 'streaming' });
      recorder.markInferenceStart();

      let budgetStopped = false;
      const markBudgetStopped = (): void => {
        budgetStopped = true;
      };
      const result =
        processed === null
          ? await this.generateVisibleAnswer(request.question, active, recorder, markBudgetStopped)
          : await this.generateFirstImageAnswer(request, processed, active, recorder, markBudgetStopped);
      if (active.cancelled) return;

      recorder.setTokenCount(result.tokenCount);
      recorder.markAnswerEnd();
      recorder.markInferenceEnd();
      const processedAnswer = postProcessAnswer(result.response);
      const notice = resolveCompletionNotice(
        budgetStopped,
        processedAnswer.verdict,
        result.tokenCount,
      );
      this.setState({
        status: 'completed',
        response: processedAnswer.text,
        metrics: recorder.build(),
        limitWarning: notice,
        pinnedExtraction: result.pinnedExtraction ?? null,
        hiddenEvidence: result.hiddenEvidence ?? null,
        objectiveResult: this.buildObjectiveResult(
          processedAnswer.text,
          processedAnswer.verdict,
          result,
          recorder,
        ),
      });
    } catch (error) {
      if (active.cancelled) return;
      this.setState({
        status: 'errored',
        response: '',
        metrics: null,
        error: toMessage(error),
        limitWarning: null,
        pinnedExtraction: null,
        hiddenEvidence: null,
        objectiveResult: null,
      });
    } finally {
      if (this.active === active) {
        this.active = null;
      }
      this.activityLock.release('vlm');
    }
  }

  cancel(): void {
    const active = this.active;
    if (active === null) return;

    active.cancelled = true;
    active.controller.abort();
    this.active = null;

    this.setState({
      status: 'cancelled',
      response: '',
      metrics: null,
      error: null,
      limitWarning: null,
      pinnedExtraction: null,
      hiddenEvidence: null,
      objectiveResult: null,
    });
    this.setState({ ...IDLE_STATE });
  }

  private async generateFirstImageAnswer(
    request: InferenceRequest,
    processed: PreprocessedImage,
    active: ActiveRequest,
    recorder: InferenceMetricsRecorder,
    markBudgetStopped: () => void
  ): Promise<EngineGenerateResult> {
    recorder.markPerceptionStart();
    const extractionResult = await this.deps.engine.generate(
      {
        imagePath: processed.path,
        question: buildStructuredExtractionPrompt(request.question),
        kind: 'extraction',
        originalQuestion: request.question,
      },
      () => {
        // Hidden perception output never streams into visible queue state.
      },
      active.controller.signal,
    );
    recorder.markPerceptionEnd();
    if (active.cancelled) {
      return extractionResult;
    }

    const extractionOutcome = await parseExtractionWithRetry(
      extractionResult.response,
      async (retryPrompt) => {
        const retryResult = await this.deps.engine.generate(
          {
            question: retryPrompt,
            kind: 'extractionRetry',
            originalQuestion: request.question,
          },
          () => {
            // Retry output is hidden for the same reason as first perception.
          },
          active.controller.signal,
        );
        return retryResult.response;
      },
      request.question,
      processed.path,
    );
    if (active.cancelled) {
      return extractionResult;
    }

    if (extractionOutcome.hiddenEvidence === null) {
      recorder.markAnswerStart();
      recorder.markFirstToken();
      recorder.markAnswerFirstToken();
      this.setState({ response: extractionOutcome.visibleAnswer });
      return {
        response: extractionOutcome.visibleAnswer,
        tokenCount: extractionResult.tokenCount,
        pinnedExtraction: extractionOutcome.pinnedExtraction,
        hiddenEvidence: null,
      };
    }

    const answerPrompt = buildAnswerPrompt({
      question: request.question,
      hiddenEvidence: extractionOutcome.hiddenEvidence,
      conversationMode: 'live',
      generationConfigId: CURRENT_GENERATION_CONFIG_ID,
      pipelineVariantId: CURRENT_PIPELINE_VARIANT_ID,
    });
    const answerResult = await this.generateVisibleAnswer(
      answerPrompt,
      active,
      recorder,
      markBudgetStopped,
      {
        kind: 'answer',
        originalQuestion: request.question,
      },
    );

    return {
      ...answerResult,
      pinnedExtraction: extractionOutcome.pinnedExtraction,
      hiddenEvidence: extractionOutcome.hiddenEvidence,
    };
  }

  private generateVisibleAnswer(
    question: string,
    active: ActiveRequest,
    recorder: InferenceMetricsRecorder,
    markBudgetStopped: () => void,
    requestPatch: Partial<EngineGenerateRequest> = {}
  ): Promise<EngineGenerateResult> {
    recorder.markAnswerStart();
    return this.deps.engine.generate(
      { question, ...requestPatch },
      (cumulative, generatedTokenCount) => {
        if (active.cancelled) return;
        recorder.markFirstToken();
        recorder.markAnswerFirstToken();
        this.setState({ response: cumulative });
        if (
          generatedTokenCount !== undefined &&
          generatedTokenCount >= OUTPUT_TOKEN_BUDGET &&
          !active.controller.signal.aborted
        ) {
          markBudgetStopped();
          active.controller.abort();
        }
      },
      active.controller.signal,
    );
  }

  private buildObjectiveResult(
    answerText: string,
    verdict: 'complete' | 'truncated' | 'looping',
    result: EngineGenerateResult,
    recorder: InferenceMetricsRecorder
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
      modelId: 'LFM2_5_VL_1_6B_QUANTIZED',
      generationConfigId: CURRENT_GENERATION_CONFIG_ID,
      pipelineVariantId: CURRENT_PIPELINE_VARIANT_ID,
      deviceNameModel: metadata.deviceNameModel,
      appBuildId: metadata.appBuildId,
    };
    if (result.promptTokenCount !== undefined) {
      record.promptTokens = result.promptTokenCount;
    }
    return record;
  }

  private resolveDeviceBuildMetadata(): DeviceBuildMetadata {
    return this.deps.getDeviceBuildMetadata?.() ?? {
      deviceNameModel: 'unknown-device',
      appBuildId: 'unknown-build',
    };
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

export function createInferenceQueue(
  engine: InferenceEngineAdapter,
  overrides: Partial<InferenceQueueDeps> = {},
): InferenceQueue {
  return new InferenceQueue({
    preprocess: prepareImageForInference,
    isReadyForInference: () => false,
    engine,
    ...overrides,
  });
}

function resolveCompletionNotice(
  budgetStopped: boolean,
  verdict: 'complete' | 'truncated' | 'looping',
  tokenCount: number,
): string | null {
  if (budgetStopped) {
    return OUTPUT_LIMIT_NOTICE;
  }
  if (verdict === 'truncated') {
    return TRUNCATED_ANSWER_NOTICE;
  }
  if (verdict === 'looping') {
    return LOOPING_ANSWER_NOTICE;
  }
  return getResponseLimitWarning(tokenCount);
}

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return 'Inference failed for an unknown reason.';
}
