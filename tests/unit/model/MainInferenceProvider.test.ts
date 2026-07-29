import {
  MAIN_INFERENCE_CONTRACT_VERSION,
  inspectProviderCompatibility,
  type MainInferenceProvider,
  type MainModelCapabilities,
} from '../../../src/model/MainInferenceProvider';
import type { TurnPlan } from '../../../src/planning/types';

function capabilities(providerId: string): MainModelCapabilities {
  return {
    providerId,
    modelDescriptor: `${providerId}-descriptor`,
    supportsTextGeneration: true,
    supportsImageInput: true,
    supportsStructuredExtraction: true,
    contextLimitTokens: 4096,
    generationLimits: { maximumTokens: 1024 },
    tokenizerDescriptor: `${providerId}-tokenizer`,
    projectorRequirements: ['vision-projector'],
    runtimeCompatibility: 'llama.rn-compatible',
    cancellation: 'supported',
    supportedPromptFormats: ['chatml'],
  };
}

function provider(providerId: string): MainInferenceProvider {
  return {
    getCapabilities: () => capabilities(providerId),
    countPromptTokens: async () => ({ tokenCount: 10 }),
    async *generate() {
      yield { type: 'token', text: 'answer' };
    },
    extractStructured: async () => ({
      status: 'complete',
      value: { summary: 'structured' },
    }),
  };
}

function imagePlan(): TurnPlan {
  return {
    planVersion: 'turn-plan-mvp-v1',
    turnId: 'turn-1',
    authorityMode: 'authoritative',
    planOwner: 'turn-planner:v1',
    intent: 'extract',
    modality: 'multimodal',
    conversationDependency: 'none',
    references: [],
    unresolvedReferences: [],
    requiredContextSources: [],
    memoryReads: [],
    memoryWrites: [],
    vision: {
      strategy: 'inspect-and-structure',
      imageReferenceIds: ['image-a'],
      evidenceIds: [],
    },
    generationTaskKind: 'extraction',
    confidence: { overall: 1, unresolvedFields: [] },
    fallback: 'execute',
  };
}

describe('MainInferenceProvider', () => {
  it('describes text, image, extraction, tokenizer, limits, projector, and cancellation capability', () => {
    const result = inspectProviderCompatibility(provider('qwen-current'), imagePlan());

    expect(result.compatible).toBe(true);
    expect(result.capabilities).toEqual(expect.objectContaining({
      supportsTextGeneration: true,
      supportsImageInput: true,
      supportsStructuredExtraction: true,
      tokenizerDescriptor: 'qwen-current-tokenizer',
      cancellation: 'supported',
    }));
  });

  it('rejects a missing required image or structured-extraction capability', () => {
    const incompatible: MainInferenceProvider = {
      ...provider('text-only'),
      getCapabilities: () => ({
        ...capabilities('text-only'),
        supportsImageInput: false,
        supportsStructuredExtraction: false,
      }),
    };

    expect(inspectProviderCompatibility(incompatible, imagePlan())).toEqual(
      expect.objectContaining({
        compatible: false,
        missingCapabilities: ['image-input', 'structured-extraction'],
      }),
    );
  });

  it('allows provider substitution without changing planning or storage contracts', () => {
    const first = inspectProviderCompatibility(provider('qwen-current'), imagePlan());
    const replacement = inspectProviderCompatibility(provider('future-provider'), imagePlan());

    expect(first.contractVersion).toBe(MAIN_INFERENCE_CONTRACT_VERSION);
    expect(replacement.contractVersion).toBe(MAIN_INFERENCE_CONTRACT_VERSION);
    expect(first.planContractVersion).toBe(replacement.planContractVersion);
    expect(first.storageContractVersion).toBe(replacement.storageContractVersion);
  });
});
