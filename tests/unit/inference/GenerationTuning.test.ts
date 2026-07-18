import { readFileSync } from 'fs';
import { join } from 'path';

import {
  CURRENT_GENERATION_CONFIG_ID,
  CURRENT_PIPELINE_VARIANT_ID,
  GENERATION_CONFIG_IDS,
  PIPELINE_VARIANT_IDS,
  QWEN_EXTRACTION_SAMPLING_PROFILE,
  QWEN_VISIBLE_SAMPLING_PROFILE,
} from '../../../src/inference/GenerationTuning';
import { LOCRA_SYSTEM_PROMPT } from '../../../src/inference/SystemPrompt';

describe('generation tuning', () => {
  it('pins visible and structured sampling separately', () => {
    expect(QWEN_VISIBLE_SAMPLING_PROFILE).toEqual({
      id: 'qwen3-vl-visible-official-v1', temperature: 0.7, topP: 0.8, topK: 20,
    });
    expect(QWEN_EXTRACTION_SAMPLING_PROFILE).toEqual({
      id: 'qwen3-vl-structured-extraction-v1', temperature: 0, topP: 1, topK: 1,
    });
  });

  it('uses only verified llama.rn snake-case sampling names at the native boundary', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/llamaRn/QwenLlamaRuntime.ts'),
      'utf8',
    );

    expect(source).toMatch(/top_k:/);
    expect(source).toMatch(/top_p:/);
    expect(source).not.toMatch(/maxTokens|sequenceLength/);
  });

  it('keeps stable generation and pipeline identifiers for reporting', () => {
    expect(GENERATION_CONFIG_IDS).toEqual([
      'qwen3-vl-2b-instruct-v1',
    ]);
    expect(PIPELINE_VARIANT_IDS).toEqual([
      'baseline-current',
      'qwen-visible-sampling-v2',
      'two-stage-v1',
    ]);
    expect(CURRENT_GENERATION_CONFIG_ID).toBe('qwen3-vl-2b-instruct-v1');
    expect(CURRENT_PIPELINE_VARIANT_ID).toBe('qwen-visible-sampling-v2');
  });

  it('uses a short positive-first persistent system prompt', () => {
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/you are locra/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/helpful offline assistant/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/most useful answer/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/conversation context/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/available image evidence/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/practical steps/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/current value cannot be confirmed/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/uncertain/i);
  });

  it('uses stateless context assembly without runtime generation overrides', () => {
    const engineSource = readFileSync(
      join(process.cwd(), 'src/inference/llamaRn/QwenLlamaRuntime.ts'),
      'utf8',
    );
    const contextSource = readFileSync(
      join(process.cwd(), 'src/inference/ContextBuilder.ts'),
      'utf8',
    );

    expect(contextSource).toContain('LOCRA_SYSTEM_PROMPT');
    expect(engineSource).toContain('convertToQwenMessages');
    expect(engineSource).not.toContain('LOCRA_GENERATION_CONFIG');
    expect(engineSource).not.toContain('DEFAULT_SYSTEM_PROMPT');
  });
});
