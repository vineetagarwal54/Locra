import {
  appendManualScore,
  formatEvaluationResultJsonl,
  parseEvaluationResultJsonl,
} from '../../../src/evaluation/QualityEvalRecorder';
import type { EvaluationResult } from '../../../src/evaluation/QualityEvalSchemas';

const RESULT: EvaluationResult = {
  caseId: 'visible-001',
  variant: 'baseline-current',
  official: true,
  caseSetVersion: 'cases.v1',
  modelId: 'LFM2_5_VL_1_6B_QUANTIZED',
  generationConfigId: 'lfm2-vl-preset',
  deviceNameModel: 'Pixel 8 Pro',
  appBuildId: 'locra-baseline',
  output: 'A red mug is visible.',
  perceptionLatencyMs: 900,
  answerTtftMs: 700,
  answerGenerationLatencyMs: 3300,
  totalEndToEndLatencyMs: 4900,
  generatedTokens: 88,
  promptTokens: 220,
  looping: false,
  truncated: false,
  timestamp: '2026-07-07T16:30:00.000Z',
};

describe('QualityEvalRecorder', () => {
  it('formats and parses one JSONL result record', () => {
    const line = formatEvaluationResultJsonl(RESULT);
    const parsed = parseEvaluationResultJsonl(`${line}\n`);

    expect(parsed).toEqual([RESULT]);
  });

  it('allows manual scoring to be added after objective capture', () => {
    const scored = appendManualScore(RESULT, {
      directAnswer: true,
      coreCorrectness: true,
      hallucination: false,
      usefulness: 5,
      notes: 'Short and correct.',
    });

    expect(scored.manualScore?.usefulness).toBe(5);
    expect(parseEvaluationResultJsonl(formatEvaluationResultJsonl(scored))).toEqual([scored]);
  });

  it('rejects malformed JSONL with a useful line number', () => {
    expect(() => parseEvaluationResultJsonl('{bad json')).toThrow(/line 1/i);
  });

  it('can require official device results', () => {
    const nonOfficial = { ...RESULT, official: false };

    expect(() =>
      parseEvaluationResultJsonl(formatEvaluationResultJsonl(nonOfficial), {
        requireOfficial: true,
      })
    ).toThrow(/official/i);
  });
});
