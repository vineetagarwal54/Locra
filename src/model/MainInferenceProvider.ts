import { TURN_PLAN_VERSION, type TurnPlan } from '../planning/types';

export const MAIN_INFERENCE_CONTRACT_VERSION = 'main-inference-provider-v1';
export const MAIN_INFERENCE_STORAGE_CONTRACT_VERSION = 'canonical-storage-v1';

export interface GenerationLimitDescriptor {
  readonly maximumTokens: number;
}

export type CancellationCapability = 'supported' | 'unsupported';

export interface MainModelCapabilities {
  readonly providerId: string;
  readonly modelDescriptor: string;
  readonly supportsTextGeneration: boolean;
  readonly supportsImageInput: boolean;
  readonly supportsStructuredExtraction: boolean;
  readonly contextLimitTokens: number;
  readonly generationLimits: GenerationLimitDescriptor;
  readonly tokenizerDescriptor: string;
  readonly projectorRequirements: readonly string[];
  readonly runtimeCompatibility: string;
  readonly cancellation: CancellationCapability;
  readonly supportedPromptFormats: readonly string[];
}

export interface PromptTokenizationInput {
  readonly prompt: string;
  readonly promptFormat: string;
}

export interface PromptTokenizationResult {
  readonly tokenCount: number;
}

export interface PlannedGenerationInput {
  readonly plan: TurnPlan;
  readonly prompt: string;
}

export interface PlannedExtractionInput {
  readonly plan: TurnPlan;
  readonly prompt: string;
  readonly imageReferenceIds: readonly string[];
}

export type GenerationEvent =
  | { readonly type: 'token'; readonly text: string }
  | { readonly type: 'completed' };

export interface StructuredExtractionResult {
  readonly status: 'complete' | 'partial' | 'failed';
  readonly value: unknown;
}

export interface MainInferenceProvider {
  getCapabilities(): MainModelCapabilities;
  countPromptTokens(
    input: PromptTokenizationInput,
    signal: AbortSignal,
  ): Promise<PromptTokenizationResult>;
  generate(
    input: PlannedGenerationInput,
    signal: AbortSignal,
  ): AsyncIterable<GenerationEvent>;
  extractStructured(
    input: PlannedExtractionInput,
    signal: AbortSignal,
  ): Promise<StructuredExtractionResult>;
}

export type MissingMainCapability =
  | 'text-generation'
  | 'image-input'
  | 'structured-extraction'
  | 'cancellation';

export interface ProviderCompatibility {
  readonly compatible: boolean;
  readonly missingCapabilities: readonly MissingMainCapability[];
  readonly capabilities: MainModelCapabilities;
  readonly contractVersion: string;
  readonly planContractVersion: string;
  readonly storageContractVersion: string;
}

export function inspectProviderCompatibility(
  provider: MainInferenceProvider,
  plan: TurnPlan,
): ProviderCompatibility {
  const capabilities = provider.getCapabilities();
  const missingCapabilities: MissingMainCapability[] = [];
  if (!capabilities.supportsTextGeneration) {
    missingCapabilities.push('text-generation');
  }
  if (plan.vision.strategy !== 'none' && !capabilities.supportsImageInput) {
    missingCapabilities.push('image-input');
  }
  if (
    plan.vision.strategy === 'inspect-and-structure'
    && !capabilities.supportsStructuredExtraction
  ) {
    missingCapabilities.push('structured-extraction');
  }
  if (capabilities.cancellation !== 'supported') {
    missingCapabilities.push('cancellation');
  }

  return {
    compatible: missingCapabilities.length === 0,
    missingCapabilities,
    capabilities,
    contractVersion: MAIN_INFERENCE_CONTRACT_VERSION,
    planContractVersion: TURN_PLAN_VERSION,
    storageContractVersion: MAIN_INFERENCE_STORAGE_CONTRACT_VERSION,
  };
}
