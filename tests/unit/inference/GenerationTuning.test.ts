import { readFileSync } from 'fs';
import { join } from 'path';

import {
  CURRENT_GENERATION_CONFIG_ID,
  CURRENT_PIPELINE_VARIANT_ID,
  GENERATION_CONFIG_IDS,
  OUTPUT_TOKEN_BUDGET,
  PIPELINE_VARIANT_IDS,
} from '../../../src/inference/GenerationTuning';
import { LOCRA_SYSTEM_PROMPT } from '../../../src/inference/SystemPrompt';

describe('generation tuning', () => {
  it('keeps only stable generation identifiers and no custom runtime sampling object', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/GenerationTuning.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/LOCRA_GENERATION_CONFIG|GenerationConfig\s*=/);
    expect(source).not.toMatch(/temperature:|topP:|minP:|repetitionPenalty:/);
  });

  it('never references topK, maxTokens, or sequenceLength', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/GenerationTuning.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/topK:|config\.topK/);
    expect(source).not.toMatch(/maxTokens|sequenceLength/);
  });

  it('keeps stable generation and pipeline identifiers for reporting', () => {
    expect(GENERATION_CONFIG_IDS).toEqual([
      'lfm2-vl-preset',
      'recommended-lfm2-vl-v1',
    ]);
    expect(PIPELINE_VARIANT_IDS).toEqual([
      'baseline-current',
      'recommended-sampling-v1',
      'two-stage-v1',
    ]);
    expect(CURRENT_GENERATION_CONFIG_ID).toBe('recommended-lfm2-vl-v1');
    expect(CURRENT_PIPELINE_VARIANT_ID).toBe('recommended-sampling-v1');
  });

  it('keeps the app-level output token budget', () => {
    expect(OUTPUT_TOKEN_BUDGET).toBeGreaterThan(256);
  });

  it('uses a concise grounded persistent system prompt', () => {
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/you are locra/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/answer the user's actual question/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/visible evidence/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/general knowledge/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/concise/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/uncertaint/i);
  });

  it('useInferenceEngine configures chat context without runtime generation overrides', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/useInferenceEngine.ts'),
      'utf8',
    );

    expect(source).toContain('LOCRA_SYSTEM_PROMPT');
    expect(source).not.toContain('LOCRA_GENERATION_CONFIG');
    expect(source).not.toMatch(/generationConfig\s*:/);
    expect(source).not.toContain('DEFAULT_SYSTEM_PROMPT');
  });
});
