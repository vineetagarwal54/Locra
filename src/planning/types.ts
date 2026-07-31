export const TURN_PLAN_VERSION = 'turn-plan-mvp-v1';

export type AuthorityMode = 'shadow' | 'controlled' | 'authoritative';

export type TurnIntent =
  | 'answer'
  | 'compare'
  | 'transform'
  | 'recall'
  | 'remember'
  | 'inspect'
  | 'extract'
  | 'retry'
  | 'regenerate'
  | 'continue'
  | 'clarify';

export type TurnModality = 'text' | 'image' | 'multimodal';

export type TurnScenarioClass =
  | 'independent-text'
  | 'new-image'
  | 'image-follow-up'
  | 'image-comparison'
  | 'assistant-follow-up'
  | 'artifact-follow-up'
  | 'topic-follow-up'
  | 'entity-follow-up'
  | 'unresolved-reference'
  | 'retry'
  | 'regeneration'
  | 'continuation';

export type ConversationDependency =
  | 'none'
  | 'recent'
  | 'ledger'
  | 'retrieval'
  | 'mixed'
  | 'unresolved';

export type GenerationTaskKind =
  | 'answer'
  | 'comparison'
  | 'extraction'
  | 'clarification'
  | 'continuation'
  | 'refusal-recovery';

export type SafeFallback =
  | 'execute'
  | 'clarify-reference'
  | 'lexical-only'
  | 'asset-unavailable'
  | 'capability-unavailable'
  | 'cancelled';

export type ReferenceTargetType =
  | 'image'
  | 'entity'
  | 'code'
  | 'document'
  | 'memory'
  | 'message'
  | 'comparison-target';

export type ReferenceResolutionCode =
  | 'attachment'
  | 'explicit-id'
  | 'explicit-ordinal'
  | 'unique-alias'
  | 'exact-lexical'
  | 'active-entity'
  | 'active-comparison';

export type AssetAvailability = 'available' | 'missing' | 'deleted' | 'unsupported';

export interface ResolvedReference {
  readonly targetType: ReferenceTargetType;
  readonly targetId: string;
  readonly resolutionCode: ReferenceResolutionCode;
  readonly confidence: number;
  readonly sourceMessageIds: readonly string[];
  readonly assetAvailability?: AssetAvailability;
}

export type UnresolvedReferenceReason =
  | 'multiple-plausible-candidates'
  | 'missing-target'
  | 'insufficient-evidence';

export interface UnresolvedReference {
  readonly targetType: ReferenceTargetType;
  readonly candidateIds: readonly string[];
  readonly reason: UnresolvedReferenceReason;
  readonly clarificationRequired: boolean;
}

export type ContextSourceType =
  | 'current-input'
  | 'recent-turn'
  | 'ledger'
  | 'lexical'
  | 'memory'
  | 'image'
  | 'code'
  | 'document';

export type ContextRequirementReason =
  | 'direct-reference'
  | 'exact-match'
  | 'active-topic'
  | 'active-entity'
  | 'active-comparison'
  | 'explicit-memory'
  | 'image-required';

export interface ContextSourceRequirement {
  readonly sourceType: ContextSourceType;
  readonly sourceId: string;
  readonly required: boolean;
  readonly reason: ContextRequirementReason;
  readonly sourceMessageIds: readonly string[];
}

export type MemoryScope = 'conversation' | 'same-chat' | 'cross-chat' | 'durable';

export interface MemoryReadRequirement {
  readonly memoryId: string;
  readonly query: string;
  readonly scope: MemoryScope;
  readonly required: boolean;
}

export interface UserFactPayload {
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  readonly verbatimText: string;
}

export interface MemoryWriteRequirement {
  readonly memoryId: string;
  readonly scope: 'conversation' | 'durable';
  readonly explicitUserCommand: boolean;
  readonly sourceMessageId: string;
  readonly confidence: number;
  readonly fact: UserFactPayload;
}

export type VisionStrategy =
  | 'none'
  | 'reuse-evidence'
  | 'inspect-original'
  | 'inspect-and-structure'
  | 'compare-evidence';

export interface VisionExecutionPlan {
  readonly strategy: VisionStrategy;
  readonly imageReferenceIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface PlanningConfidence {
  readonly overall: number;
  readonly unresolvedFields: readonly string[];
}

export interface TurnPlan {
  readonly planVersion: string;
  readonly turnId: string;
  readonly authorityMode: AuthorityMode;
  readonly planOwner: string;
  readonly scenarioClass: TurnScenarioClass;
  readonly intent: TurnIntent;
  readonly modality: TurnModality;
  readonly conversationDependency: ConversationDependency;
  readonly references: readonly ResolvedReference[];
  readonly unresolvedReferences: readonly UnresolvedReference[];
  readonly requiredContextSources: readonly ContextSourceRequirement[];
  readonly memoryReads: readonly MemoryReadRequirement[];
  readonly memoryWrites: readonly MemoryWriteRequirement[];
  readonly vision: VisionExecutionPlan;
  readonly generationTaskKind: GenerationTaskKind;
  readonly confidence: PlanningConfidence;
  readonly fallback: SafeFallback;
}

export type ValidationChangeCode =
  | 'confidence-clamped'
  | 'duplicate-entry-removed'
  | 'unresolved-image-selection-removed'
  | 'missing-image-fallback'
  | 'unavailable-image-fallback'
  | 'image-capability-fallback'
  | 'structured-extraction-capability-fallback'
  | 'uncertain-durable-memory-write-removed';

export interface TurnPlanValidationChange {
  readonly field: string;
  readonly code: ValidationChangeCode;
}

export interface TurnPlanValidationResult {
  readonly valid: boolean;
  readonly plan: TurnPlan;
  readonly changes: readonly TurnPlanValidationChange[];
}
