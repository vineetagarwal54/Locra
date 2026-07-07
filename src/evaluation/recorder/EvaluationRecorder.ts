import type { ObjectiveInferenceResultRecord } from '../../inference/ObjectiveInferenceResultRecord';
import { EVALUATION_CASE_SET_VERSION, type EvaluationResult, type ManualScore } from '../QualityEvalSchemas';

export interface DevOnlyEvaluationRecorderState {
  currentObjectiveRecord: ObjectiveInferenceResultRecord | null;
  selectedCaseId: string | null;
  subjectiveDraft: Partial<ManualScore>;
  isAvailable: boolean;
}

export interface CreateEvaluationRecorderStateInput {
  currentObjectiveRecord: ObjectiveInferenceResultRecord | null;
  selectedCaseId?: string | null;
  isAvailable: boolean;
}

export function createEvaluationRecorderState(
  input: CreateEvaluationRecorderStateInput
): DevOnlyEvaluationRecorderState {
  return {
    currentObjectiveRecord: input.currentObjectiveRecord,
    selectedCaseId: input.selectedCaseId ?? null,
    subjectiveDraft: {},
    isAvailable: input.isAvailable,
  };
}

export function updateSubjectiveDraft(
  state: DevOnlyEvaluationRecorderState,
  draft: Partial<ManualScore>
): DevOnlyEvaluationRecorderState {
  return {
    ...state,
    subjectiveDraft: { ...state.subjectiveDraft, ...draft },
  };
}

export function buildEvaluationResultDraft(state: DevOnlyEvaluationRecorderState): EvaluationResult {
  if (!state.isAvailable) {
    throw new Error('Evaluation recorder is unavailable in this build.');
  }
  if (state.currentObjectiveRecord === null) {
    throw new Error('Evaluation recorder has no completed objective result.');
  }
  if (state.selectedCaseId === null || state.selectedCaseId.trim() === '') {
    throw new Error('Evaluation recorder requires a caseId.');
  }

  const objective = state.currentObjectiveRecord;
  const result: EvaluationResult = {
    caseId: state.selectedCaseId,
    variant: objective.pipelineVariantId,
    official: false,
    caseSetVersion: EVALUATION_CASE_SET_VERSION,
    modelId: objective.modelId,
    generationConfigId: objective.generationConfigId,
    deviceNameModel: objective.deviceNameModel,
    appBuildId: objective.appBuildId,
    output: objective.answerText,
    perceptionLatencyMs: objective.perceptionLatencyMs,
    answerTtftMs: objective.answerTtftMs,
    answerGenerationLatencyMs: objective.answerGenerationLatencyMs,
    totalEndToEndLatencyMs: objective.totalEndToEndLatencyMs,
    generatedTokens: objective.generatedTokens,
    looping: objective.looping,
    truncated: objective.truncated,
    timestamp: objective.timestamp,
  };

  if (objective.promptTokens !== undefined) {
    result.promptTokens = objective.promptTokens;
  }
  if (isCompleteManualScore(state.subjectiveDraft)) {
    result.manualScore = state.subjectiveDraft;
  }

  return result;
}

function isCompleteManualScore(value: Partial<ManualScore>): value is ManualScore {
  return (
    typeof value.directAnswer === 'boolean' &&
    typeof value.coreCorrectness === 'boolean' &&
    typeof value.hallucination === 'boolean' &&
    typeof value.usefulness === 'number'
  );
}
