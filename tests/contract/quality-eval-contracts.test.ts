import {
  EVALUATION_CASE_SET_VERSION,
  type EvaluationCase,
  type EvaluationResult,
  validateEvaluationCase,
  validateEvaluationResult,
  validateOfficialEvaluationResult,
} from '../../src/evaluation/QualityEvalSchemas';

describe('quality evaluation contracts', () => {
  it('accepts the documented evaluation case contract shape', () => {
    const evaluationCase: EvaluationCase = {
      caseId: 'pan-001',
      category: 'practicalAdvice',
      title: 'Worn cooking pan advice',
      imageSource: {
        type: 'repoAsset',
        path: 'quality-eval/images/pan-001.jpg',
        licenseOrOrigin: 'project-created sample',
      },
      question: 'How do I fix this?',
      followUps: [],
      expectedCriteria: [
        'Answers the repair/use question directly',
        'Grounds visible claims in the pan condition',
        'Avoids unsupported certainty about coating/material',
      ],
      tags: ['first-turn', 'grounded-advice'],
      officialDeviceRequired: true,
    };

    expect(validateEvaluationCase(evaluationCase).errors).toEqual([]);
  });

  it('accepts the documented official evaluation result contract shape', () => {
    const result: EvaluationResult = {
      caseId: 'pan-001',
      variant: 'two-stage-v1',
      official: true,
      caseSetVersion: EVALUATION_CASE_SET_VERSION,
      modelId: 'LFM2_5_VL_1_6B_QUANTIZED',
      generationConfigId: 'recommended-lfm2-vl-v1',
      deviceNameModel: 'Pixel 8 Pro',
      appBuildId: 'locra-android-2026-07-07',
      output: 'The pan surface appears worn.',
      perceptionLatencyMs: 1180,
      answerTtftMs: 820,
      answerGenerationLatencyMs: 6220,
      totalEndToEndLatencyMs: 7400,
      generatedTokens: 186,
      promptTokens: 512,
      looping: false,
      truncated: false,
      timestamp: '2026-07-07T16:30:00.000Z',
      manualScore: {
        directAnswer: true,
        coreCorrectness: true,
        hallucination: false,
        usefulness: 4,
        notes: 'Useful but slightly verbose',
      },
    };

    expect(validateEvaluationResult(result).errors).toEqual([]);
    expect(validateOfficialEvaluationResult(result).errors).toEqual([]);
  });

  it('rejects result records that omit official-run metadata required by the contract', () => {
    const invalid = {
      caseId: 'pan-001',
      variant: 'two-stage-v1',
      official: true,
      caseSetVersion: EVALUATION_CASE_SET_VERSION,
      modelId: 'LFM2_5_VL_1_6B_QUANTIZED',
      generationConfigId: 'recommended-lfm2-vl-v1',
      output: 'Missing device metadata.',
      perceptionLatencyMs: 1180,
      answerTtftMs: 820,
      answerGenerationLatencyMs: 6220,
      totalEndToEndLatencyMs: 7400,
      generatedTokens: 186,
      looping: false,
      truncated: false,
      timestamp: '2026-07-07T16:30:00.000Z',
    };

    expect(validateOfficialEvaluationResult(invalid).ok).toBe(false);
  });
});
