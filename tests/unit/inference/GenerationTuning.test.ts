import { readFileSync } from 'fs';
import { join } from 'path';

import {
  LOCRA_GENERATION_CONFIG,
  OUTPUT_TOKEN_BUDGET,
} from '../../../src/inference/GenerationTuning';
import { LOCRA_SYSTEM_PROMPT } from '../../../src/inference/SystemPrompt';

describe('generation tuning (FR-050, FR-051, FR-052)', () => {
  it('uses exactly the research.md-confirmed generationConfig fields, tuned per plan', () => {
    expect(LOCRA_GENERATION_CONFIG).toEqual({
      temperature: 0.35,
      repetitionPenalty: 1.05,
      minP: 0.05,
    });
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
    expect(source).not.toMatch(/topK/);
  });

  it('enforces output length at the app level with a positive token budget (FR-052)', () => {
    expect(OUTPUT_TOKEN_BUDGET).toBe(256);
  });

  it('system prompt sets a role and the visible-only / no-speculation / concise constraints (FR-050)', () => {
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/you are/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/visible/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/speculat|guess/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/concise|brief|short/i);
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
