import { readFileSync } from 'fs';
import { join } from 'path';

import {
  LOCRA_GENERATION_CONFIG,
  OUTPUT_TOKEN_BUDGET,
} from '../../../src/inference/GenerationTuning';
import { LOCRA_SYSTEM_PROMPT } from '../../../src/inference/SystemPrompt';

describe('generation tuning (FR-051, FR-052)', () => {
  it('uses only 0.9.2-verified generationConfig fields, tuned for expansiveness', () => {
    expect(LOCRA_GENERATION_CONFIG).toEqual({
      temperature: 0.7,
      topP: 0.95,
      minP: 0.05,
      repetitionPenalty: 1.05,
    });
    // Warmer than the model card's clipped 0.1 default, for bolder answers.
    expect(LOCRA_GENERATION_CONFIG.temperature).toBeGreaterThan(0.35);
  });

  it('never references topK, maxTokens, or sequenceLength — none exist on the installed API', () => {
    const config = LOCRA_GENERATION_CONFIG as Record<string, unknown>;

    expect(config.topK).toBeUndefined();
    expect(config.maxTokens).toBeUndefined();
    expect(config.sequenceLength).toBeUndefined();

    const source = readFileSync(
      join(process.cwd(), 'src/inference/GenerationTuning.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/config\.topK|topK:/);
  });

  it('enforces output length at the app level with a positive, expansive budget (FR-052)', () => {
    expect(OUTPUT_TOKEN_BUDGET).toBeGreaterThan(256);
  });

  it('the persistent system prompt is expansive identity, NOT perception constraints (FR-050)', () => {
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/you are locra/i);
    // The perception rules (visible-only / speculation) must NOT be persistent —
    // they now live only in the turn-1 extraction wrapper.
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/visible/i);
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/speculat/i);
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/concise/i);
  });

  it('useInferenceEngine configures the tuned generationConfig and the Locra system prompt', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/useInferenceEngine.ts'),
      'utf8'
    );

    expect(source).toContain('LOCRA_GENERATION_CONFIG');
    expect(source).toContain('LOCRA_SYSTEM_PROMPT');
    expect(source).toContain('generationConfig');
    expect(source).not.toContain('DEFAULT_SYSTEM_PROMPT');
  });
});
