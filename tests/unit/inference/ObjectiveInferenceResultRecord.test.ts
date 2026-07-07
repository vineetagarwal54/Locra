import { readFileSync } from 'fs';
import { join } from 'path';

import {
  OBJECTIVE_INFERENCE_RESULT_RECORD_FIELDS,
  type ObjectiveInferenceResultRecord,
} from '../../../src/inference/ObjectiveInferenceResultRecord';

describe('ObjectiveInferenceResultRecord', () => {
  it('defines the production-owned objective fields required by evaluation export', () => {
    expect(OBJECTIVE_INFERENCE_RESULT_RECORD_FIELDS).toEqual([
      'answerText',
      'perceptionLatencyMs',
      'answerTtftMs',
      'answerGenerationLatencyMs',
      'totalEndToEndLatencyMs',
      'generatedTokens',
      'promptTokens',
      'truncated',
      'looping',
      'timestamp',
      'modelId',
      'generationConfigId',
      'pipelineVariantId',
      'deviceNameModel',
      'appBuildId',
    ]);
  });

  it('allows prompt token count to be absent when the runtime cannot provide it', () => {
    const record: ObjectiveInferenceResultRecord = {
      answerText: 'The pan surface appears worn, so avoid high heat and inspect the coating.',
      perceptionLatencyMs: 1180,
      answerTtftMs: 820,
      answerGenerationLatencyMs: 6220,
      totalEndToEndLatencyMs: 7400,
      generatedTokens: 186,
      truncated: false,
      looping: false,
      timestamp: '2026-07-07T16:30:00.000Z',
      modelId: 'LFM2_5_VL_1_6B_QUANTIZED',
      generationConfigId: 'lfm2-vl-preset',
      pipelineVariantId: 'baseline-current',
      deviceNameModel: 'Pixel 8 Pro',
      appBuildId: 'locra-dev',
    };

    expect(record.promptTokens).toBeUndefined();
    expect(record.pipelineVariantId).toBe('baseline-current');
  });

  it('is owned by production inference and does not import evaluation helpers', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/ObjectiveInferenceResultRecord.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/src\/evaluation|quality-eval|\.\.\/evaluation/);
  });
});
