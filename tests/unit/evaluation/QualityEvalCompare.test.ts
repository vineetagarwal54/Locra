import { compareEvaluationResults } from '../../../src/evaluation/QualityEvalCompare';
import type { EvaluationResult } from '../../../src/evaluation/QualityEvalSchemas';

function makeResult(caseId: string, usefulness: number, variant: string): EvaluationResult {
  return {
    caseId,
    variant,
    official: true,
    caseSetVersion: 'cases.v1',
    modelId: 'LFM2_5_VL_1_6B_QUANTIZED',
    generationConfigId: 'lfm2-vl-preset',
    deviceNameModel: 'Pixel 8 Pro',
    appBuildId: 'locra-build',
    output: `${variant} output`,
    perceptionLatencyMs: 1000,
    answerTtftMs: 800,
    answerGenerationLatencyMs: 3000,
    totalEndToEndLatencyMs: 4800,
    generatedTokens: 90,
    promptTokens: 220,
    looping: false,
    truncated: false,
    timestamp: '2026-07-07T16:30:00.000Z',
    manualScore: {
      directAnswer: true,
      coreCorrectness: true,
      hallucination: false,
      usefulness,
    },
  };
}

describe('QualityEvalCompare', () => {
  it('compares baseline and candidate by case id and usefulness delta', () => {
    const comparison = compareEvaluationResults(
      [makeResult('visible-001', 3, 'baseline-current')],
      [makeResult('visible-001', 5, 'two-stage-v1')]
    );

    expect(comparison.cases[0]).toMatchObject({
      caseId: 'visible-001',
      status: 'improved',
      usefulnessDelta: 2,
    });
    expect(comparison.summary).toMatchObject({ sharedCases: 1, improved: 1 });
  });

  it('rejects non-official dry-run artifacts for official reporting', () => {
    const dryRun = { ...makeResult('visible-001', 3, 'baseline-current'), official: false };

    expect(() =>
      compareEvaluationResults([dryRun], [makeResult('visible-001', 4, 'two-stage-v1')])
    ).toThrow(/not an official device result/i);
  });
});
