import {
  EVALUATION_CASE_SET_VERSION,
  type EvaluationCase,
  type EvaluationResult,
  validateEvaluationCase,
  validateEvaluationCaseSet,
  validateEvaluationResult,
  validateOfficialEvaluationResult,
} from '../../../src/evaluation/QualityEvalSchemas';

function makeCase(overrides: Partial<EvaluationCase> = {}): EvaluationCase {
  return {
    caseId: 'visible-001',
    category: 'visibleFacts',
    title: 'Visible object',
    imageSource: {
      type: 'repoAsset',
      path: 'quality-eval/images/visible-001.svg',
      licenseOrOrigin: 'project-created sample',
    },
    question: 'What is on the table?',
    followUps: [],
    expectedCriteria: ['Names the visible object'],
    tags: ['visible'],
    officialDeviceRequired: true,
    ...overrides,
  };
}

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    caseId: 'visible-001',
    variant: 'baseline-current',
    official: true,
    caseSetVersion: EVALUATION_CASE_SET_VERSION,
    modelId: 'LFM2_5_VL_1_6B_QUANTIZED',
    generationConfigId: 'lfm2-vl-preset',
    deviceNameModel: 'Pixel 8 Pro',
    appBuildId: 'locra-baseline',
    output: 'A red mug is on the table.',
    perceptionLatencyMs: 1000,
    answerTtftMs: 800,
    answerGenerationLatencyMs: 4200,
    totalEndToEndLatencyMs: 6000,
    generatedTokens: 120,
    promptTokens: 256,
    looping: false,
    truncated: false,
    timestamp: '2026-07-07T16:30:00.000Z',
    ...overrides,
  };
}

describe('QualityEvalSchemas', () => {
  it('accepts a complete evaluation case', () => {
    expect(validateEvaluationCase(makeCase()).ok).toBe(true);
  });

  it('rejects an unknown category', () => {
    const result = validateEvaluationCase({ ...makeCase(), category: 'other' });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/category/);
  });

  it('requires 18 cases, 3 per category, and at least 80 percent repo assets', () => {
    const categories = [
      'visibleFacts',
      'textReading',
      'visualReasoning',
      'practicalAdvice',
      'activeFollowUpContext',
      'resumedConversationContext',
    ] as const;
    const cases = categories.flatMap((category) =>
      [0, 1, 2].map((index) =>
        makeCase({
          caseId: `${category}-${index}`,
          category,
          imageSource:
            category === 'practicalAdvice' && index === 2
              ? {
                  type: 'manualDeviceCapture',
                  instructions: 'Capture a worn pan under kitchen lighting.',
                  licenseOrOrigin: 'manual device capture',
                }
              : {
                  type: 'repoAsset',
                  path: `quality-eval/images/${category}-${index}.svg`,
                  licenseOrOrigin: 'project-created sample',
                },
        })
      )
    );

    expect(validateEvaluationCaseSet(cases).ok).toBe(true);
  });

  it('accepts objective result records with optional manual scores', () => {
    const result = validateEvaluationResult(
      makeResult({
        manualScore: {
          directAnswer: true,
          coreCorrectness: true,
          hallucination: false,
          usefulness: 4,
        },
      })
    );

    expect(result.ok).toBe(true);
  });

  it('rejects invalid manual usefulness scores', () => {
    const result = validateEvaluationResult(
      makeResult({
        manualScore: {
          directAnswer: true,
          coreCorrectness: true,
          hallucination: false,
          usefulness: 6,
        },
      })
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/usefulness/);
  });

  it('requires official metadata for official artifacts', () => {
    expect(validateOfficialEvaluationResult(makeResult()).ok).toBe(true);
    expect(validateOfficialEvaluationResult(makeResult({ official: false })).ok).toBe(false);
    expect(validateEvaluationResult({ ...makeResult(), appBuildId: '' }).ok).toBe(false);
  });
});
