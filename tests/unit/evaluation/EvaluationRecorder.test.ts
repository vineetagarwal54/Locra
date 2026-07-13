import {
  buildEvaluationResultDraft,
  createEvaluationRecorderState,
  updateSubjectiveDraft,
} from '../../../src/evaluation/recorder/EvaluationRecorder';
import type { ObjectiveInferenceResultRecord } from '../../../src/inference/ObjectiveInferenceResultRecord';

const OBJECTIVE_RECORD: ObjectiveInferenceResultRecord = {
  answerText: 'The pan surface appears worn, so use lower heat and inspect the coating.',
  perceptionLatencyMs: 250,
  answerTtftMs: 120,
  answerGenerationLatencyMs: 1400,
  totalEndToEndLatencyMs: 1850,
  generatedTokens: 42,
  promptTokens: 120,
  truncated: false,
  looping: false,
  timestamp: '2026-07-07T16:30:00.000Z',
  modelId: 'LFM2_5_VL_1_6B_QUANTIZED',
  generationConfigId: 'recommended-lfm2-vl-v1',
  pipelineVariantId: 'recommended-sampling-v1',
  deviceNameModel: 'Pixel 8 Pro',
  appBuildId: 'locra-dev-123',
};

describe('EvaluationRecorder', () => {
  it('populates objective evaluation fields from the production result DTO', () => {
    const state = createEvaluationRecorderState({
      currentObjectiveRecord: OBJECTIVE_RECORD,
      selectedCaseId: 'practical-001',
      isAvailable: true,
    });
    const draft = buildEvaluationResultDraft(state);

    expect(draft).toEqual(
      expect.objectContaining({
        caseId: 'practical-001',
        variant: 'recommended-sampling-v1',
        caseSetVersion: 'cases.v1',
        modelId: OBJECTIVE_RECORD.modelId,
        generationConfigId: OBJECTIVE_RECORD.generationConfigId,
        output: OBJECTIVE_RECORD.answerText,
        perceptionLatencyMs: OBJECTIVE_RECORD.perceptionLatencyMs,
        answerTtftMs: OBJECTIVE_RECORD.answerTtftMs,
        answerGenerationLatencyMs: OBJECTIVE_RECORD.answerGenerationLatencyMs,
        totalEndToEndLatencyMs: OBJECTIVE_RECORD.totalEndToEndLatencyMs,
        generatedTokens: OBJECTIVE_RECORD.generatedTokens,
        promptTokens: OBJECTIVE_RECORD.promptTokens,
        deviceNameModel: OBJECTIVE_RECORD.deviceNameModel,
        appBuildId: OBJECTIVE_RECORD.appBuildId,
      }),
    );
  });

  it('passes Gemma identity through with the unchanged case-set version', () => {
    const gemmaObjective: ObjectiveInferenceResultRecord = {
      ...OBJECTIVE_RECORD,
      modelId: 'GEMMA4_E2B_MM',
      generationConfigId: 'gemma4-e2b-mm-library-default',
    };
    const state = createEvaluationRecorderState({
      currentObjectiveRecord: gemmaObjective,
      selectedCaseId: 'practical-001',
      isAvailable: true,
    });

    expect(buildEvaluationResultDraft(state)).toMatchObject({
      caseSetVersion: 'cases.v1',
      modelId: gemmaObjective.modelId,
      generationConfigId: gemmaObjective.generationConfigId,
    });
  });

  it('keeps subjective fields separate from objective fields until scoring', () => {
    const state = updateSubjectiveDraft(
      createEvaluationRecorderState({
        currentObjectiveRecord: OBJECTIVE_RECORD,
        selectedCaseId: 'practical-001',
        isAvailable: true,
      }),
      {
        directAnswer: true,
        coreCorrectness: true,
        hallucination: false,
        usefulness: 5,
        notes: 'Direct and practical.',
      },
    );
    const draft = buildEvaluationResultDraft(state);

    expect(state.currentObjectiveRecord).toEqual(OBJECTIVE_RECORD);
    expect(state.subjectiveDraft).toEqual({
      directAnswer: true,
      coreCorrectness: true,
      hallucination: false,
      usefulness: 5,
      notes: 'Direct and practical.',
    });
    expect(draft.manualScore).toEqual(state.subjectiveDraft);
    expect(draft.output).toBe(OBJECTIVE_RECORD.answerText);
  });
});
