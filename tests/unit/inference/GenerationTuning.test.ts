import { readFileSync } from 'fs';
import { join } from 'path';

import {
  CURRENT_GENERATION_CONFIG_ID,
  CURRENT_PIPELINE_VARIANT_ID,
  GENERATION_CONFIG_IDS,
  PIPELINE_VARIANT_IDS,
  QWEN_EXTRACTION_SAMPLING_PROFILE,
  QWEN_VISIBLE_SAMPLING_PROFILE,
  createGenerationPlan,
  resolveGenerationTarget,
} from '../../../src/inference/GenerationTuning';
import type { RequestClassification } from '../../../src/inference/RequestClassifier';
import { LOCRA_SYSTEM_PROMPT } from '../../../src/inference/SystemPrompt';

function classification(overrides: Partial<RequestClassification>): RequestClassification {
  return {
    isIndependentTextQuestion: false,
    isTextFollowUp: false,
    isNewImageQuestion: false,
    isSameImageFollowUp: false,
    isOlderImageReference: false,
    isPixelDependent: false,
    isLongContextRetrievalRequest: false,
    isCrossChatEligible: false,
    referencedImageId: null,
    imageReferenceAmbiguous: false,
    hasVisualReference: false,
    hasOrdinalImageReference: false,
    hasDescriptiveImageReference: false,
    isMultipleImageComparison: false,
    requestsDetailedAnswer: false,
    ...overrides,
  };
}

describe('generation tuning', () => {
  it('reduces only independent and short-follow-up soft targets', () => {
    expect(resolveGenerationTarget(
      'High',
      classification({ isIndependentTextQuestion: true }),
    )).toBe(160);
    expect(resolveGenerationTarget(
      'High',
      classification({ isTextFollowUp: true }),
    )).toBe(256);
    expect(resolveGenerationTarget(
      'High',
      classification({ isTextFollowUp: true, isLongContextRetrievalRequest: true }),
    )).toBe(768);
    expect(resolveGenerationTarget(
      'Medium',
      classification({ isTextFollowUp: true, isSameImageFollowUp: true }),
    )).toBe(384);
  });

  it.each([
    ['What is a mutex?', 192],
    ['Give the short definition of a mutex.', 192],
  ])('creates a concise independent plan for "%s"', (question, maximum) => {
    const plan = createGenerationPlan(
      'High',
      question,
      classification({ isIndependentTextQuestion: true }),
      'text',
    );
    expect(plan.effectiveHardLimit).toBeLessThanOrEqual(maximum);
    expect(plan.diagnosticsId).toBe('concise-text-v1');
  });

  it.each([
    'Explain the entire process step by step and include examples.',
    'Provide a comprehensive comparison of all the options.',
  ])('preserves the mode hard limit for detailed wording: "%s"', (question) => {
    const plan = createGenerationPlan(
      'High',
      question,
      classification({ isIndependentTextQuestion: true, requestsDetailedAnswer: true }),
      'text',
    );
    expect(plan.effectiveHardLimit).toBe(1024);
    expect(plan.detailed).toBe(true);
  });

  it('gives extraction lists more room than identification without allowing an essay', () => {
    const extraction = createGenerationPlan(
      'High',
      'List every readable line in these screenshots.',
      classification({ isPixelDependent: true, hasVisualReference: true }),
      'image',
    );
    const identification = createGenerationPlan(
      'High',
      'What is in this image?',
      classification({ isNewImageQuestion: true, hasVisualReference: true }),
      'image',
    );
    expect(extraction.effectiveHardLimit).toBeGreaterThan(identification.effectiveHardLimit);
    expect(extraction.effectiveHardLimit).toBeLessThan(1024);
  });
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
