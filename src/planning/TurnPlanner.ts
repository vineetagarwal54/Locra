import {
  evaluateConstrainedPlannerGate,
  type ConstrainedPlannerGate,
  type ConstrainedPlannerGateInput,
} from './ConstrainedPlannerFallback';
import {
  resolveLexicalLedgerMatches,
  type LexicalLedgerItem,
} from './LexicalPlanningSignals';
import {
  resolvePlannerActivation,
  type PlannerActivationConfig,
} from './PlannerActivation';
import {
  validateTurnPlan,
  type TurnPlanProviderCapabilities,
} from './TurnPlanValidator';
import {
  TURN_PLAN_VERSION,
  type ContextSourceRequirement,
  type ConversationDependency,
  type GenerationTaskKind,
  type MemoryReadRequirement,
  type MemoryWriteRequirement,
  type ReferenceResolutionCode,
  type ReferenceTargetType,
  type ResolvedReference,
  type SafeFallback,
  type TurnIntent,
  type TurnModality,
  type TurnPlan,
  type TurnPlanValidationResult,
  type UnresolvedReference,
  type VisionExecutionPlan,
} from './types';

export type PlanningAction =
  | 'none'
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

export interface PlanningApplicationState {
  readonly action: PlanningAction;
  readonly userText?: string;
  readonly attachedImageIds: readonly string[];
  readonly availableImageIds: readonly string[];
  readonly directReferenceIds?: readonly string[];
  readonly embeddingsAvailable?: boolean;
  readonly mainProviderDescriptor?: string;
  readonly providerCapabilities?: TurnPlanProviderCapabilities;
  readonly explicitMemoryWrite?: MemoryWriteRequirement;
}

export interface PlanningLedgerEntity {
  readonly id: string;
  readonly canonicalLabel: string;
  readonly aliases: readonly string[];
}

export interface PlanningLedgerState {
  readonly activeTopicIds: readonly string[];
  readonly activeTopics?: readonly LexicalLedgerItem[];
  readonly activeEntities: readonly PlanningLedgerEntity[];
  readonly activeComparisonTargetIds: readonly string[];
  readonly activeImageIds: readonly string[];
}

export type PlanningReferenceMatch = 'direct' | 'exact' | 'alias' | 'active';

export interface PlanningReferenceCandidate {
  readonly id: string;
  readonly targetType: ReferenceTargetType;
  readonly match: PlanningReferenceMatch;
  readonly materiallyPlausible: boolean;
  readonly sourceMessageIds: readonly string[];
}

export interface ExplicitMemoryCandidate {
  readonly id: string;
  readonly query: string;
  readonly scope: 'same-chat' | 'cross-chat';
  readonly exact: boolean;
}

export interface LexicalRetrievalCandidate {
  readonly id: string;
  readonly sourceType: 'memory' | 'code' | 'document' | 'lexical';
  readonly required: boolean;
  readonly sourceMessageIds?: readonly string[];
}

export interface TurnPlanningSignals {
  readonly referenceCandidates: readonly PlanningReferenceCandidate[];
  readonly explicitMemoryCandidates: readonly ExplicitMemoryCandidate[];
  readonly lexicalRetrievalCandidates: readonly LexicalRetrievalCandidate[];
  readonly activeTopicMatches: readonly string[];
  readonly activeEntityMatches: readonly string[];
  readonly recentDependency?: boolean;
  readonly intent?: TurnIntent;
  readonly memoryInterpretation?: 'read' | 'write' | 'neither' | 'unresolved';
  readonly requestedContextScope?: 'current-turn' | 'recent' | 'same-chat' | 'cross-chat';
}

export interface TurnPlanningInput {
  readonly turnId: string;
  readonly scenarioClass: string;
  readonly activation: PlannerActivationConfig;
  readonly applicationState: PlanningApplicationState;
  readonly ledgerState: PlanningLedgerState;
  readonly signals: TurnPlanningSignals;
}

export interface TurnPlannerResult {
  readonly plan: TurnPlan;
  readonly validation: TurnPlanValidationResult;
  readonly constrainedPlannerInvoked: false;
  readonly constrainedPlannerWouldInvoke: boolean;
  readonly constrainedPlannerGate: ConstrainedPlannerGate;
}

export class TurnPlanner {
  plan(input: TurnPlanningInput): TurnPlannerResult {
    const activation = resolvePlannerActivation(input.activation, input.scenarioClass);
    const references = resolveReferences(input);
    const unresolvedReferences = unresolvedReferencesFor(input, references);
    const requiredContextSources = contextSourcesFor(input, references);
    const memoryReads = memoryReadsFor(input);
    const memoryWrites = memoryWritesFor(input);
    const vision = visionPlanFor(input, references, unresolvedReferences);
    const intent = intentFor(input);
    const dependency = dependencyFor(input, references);
    const fallback = fallbackFor(input, unresolvedReferences);
    const draft: TurnPlan = {
      planVersion: TURN_PLAN_VERSION,
      turnId: input.turnId,
      authorityMode: activation.authorityMode,
      planOwner: activation.planOwner,
      intent,
      modality: modalityFor(input, references),
      conversationDependency: dependency,
      references,
      unresolvedReferences,
      requiredContextSources,
      memoryReads,
      memoryWrites,
      vision,
      generationTaskKind: generationTaskFor(intent),
      confidence: {
        overall: unresolvedReferences.length === 0 ? 1 : 0.5,
        unresolvedFields: unresolvedReferences.length === 0 ? [] : ['references'],
      },
      fallback,
    };
    const validation = validateTurnPlan(
      draft,
      input.applicationState.providerCapabilities,
    );
    const gateInput = constrainedGateInput(input, validation.plan);
    const constrainedPlannerGate = evaluateConstrainedPlannerGate(gateInput);
    return {
      plan: validation.plan,
      validation,
      constrainedPlannerInvoked: false,
      constrainedPlannerWouldInvoke: constrainedPlannerGate.invoke,
      constrainedPlannerGate,
    };
  }
}

function resolveReferences(input: TurnPlanningInput): ResolvedReference[] {
  const references: ResolvedReference[] = input.applicationState.attachedImageIds.map((id) => ({
    targetType: 'image',
    targetId: id,
    resolutionCode: 'attachment',
    confidence: 1,
    sourceMessageIds: [input.turnId],
    assetAvailability: input.applicationState.availableImageIds.includes(id)
      ? 'available'
      : undefined,
  }));
  const plausible = input.signals.referenceCandidates
    .filter((candidate) => candidate.materiallyPlausible)
    .sort(compareReferenceCandidates);
  const direct = plausible.filter(
    (candidate) => candidate.match === 'direct' || candidate.match === 'exact',
  );
  const selected = direct.length > 0
    ? direct
    : plausible.length === 1
      ? plausible
      : [];

  for (const candidate of selected) {
    references.push({
      targetType: candidate.targetType,
      targetId: candidate.id,
      resolutionCode: resolutionCodeFor(candidate.match),
      confidence: candidate.match === 'direct' || candidate.match === 'exact' ? 1 : 0.9,
      sourceMessageIds: [...candidate.sourceMessageIds],
      assetAvailability:
        candidate.targetType === 'image'
          && input.applicationState.availableImageIds.includes(candidate.id)
          ? 'available'
          : undefined,
    });
  }
  return uniqueReferences(references);
}

function unresolvedReferencesFor(
  input: TurnPlanningInput,
  resolved: readonly ResolvedReference[],
): UnresolvedReference[] {
  const resolvedIds = new Set(resolved.map((reference) => reference.targetId));
  const plausible = input.signals.referenceCandidates
    .filter(
      (candidate) =>
        candidate.materiallyPlausible
        && !resolvedIds.has(candidate.id),
    )
    .sort(compareReferenceCandidates);
  if (plausible.length < 2) {
    return [];
  }
  const targetTypes = new Set(plausible.map((candidate) => candidate.targetType));
  if (targetTypes.size !== 1) {
    return [];
  }
  return [{
    targetType: plausible[0].targetType,
    candidateIds: plausible.map((candidate) => candidate.id),
    reason: 'multiple-plausible-candidates',
    clarificationRequired: true,
  }];
}

function contextSourcesFor(
  input: TurnPlanningInput,
  references: readonly ResolvedReference[],
): ContextSourceRequirement[] {
  const sources: ContextSourceRequirement[] = [];
  const lexicalLedger = lexicalLedgerMatchesFor(input);
  for (const reference of references) {
    sources.push({
      sourceType: sourceTypeForReference(reference.targetType),
      sourceId: reference.targetId,
      required: true,
      reason: 'direct-reference',
      sourceMessageIds: [...reference.sourceMessageIds],
    });
  }
  for (const entityId of uniqueStrings([
    ...input.signals.activeEntityMatches,
    ...lexicalLedger.entityIds,
  ])) {
    sources.push({
      sourceType: 'ledger',
      sourceId: entityId,
      required: true,
      reason: 'active-entity',
      sourceMessageIds: [],
    });
  }
  for (const topicId of uniqueStrings([
    ...input.signals.activeTopicMatches,
    ...lexicalLedger.topicIds,
  ])) {
    sources.push({
      sourceType: 'ledger',
      sourceId: topicId,
      required: false,
      reason: 'active-topic',
      sourceMessageIds: [],
    });
  }
  for (const targetId of lexicalLedger.comparisonTargetIds) {
    const lexicalTarget = input.signals.lexicalRetrievalCandidates.some(
      (candidate) => candidate.id === targetId,
    );
    if (!lexicalTarget) {
      sources.push({
        sourceType: 'ledger',
        sourceId: targetId,
        required: true,
        reason: 'active-comparison',
        sourceMessageIds: [],
      });
    }
  }
  for (const memory of input.signals.explicitMemoryCandidates.filter(
    (candidate) => candidate.exact,
  )) {
    sources.push({
      sourceType: 'memory',
      sourceId: memory.id,
      required: true,
      reason: 'explicit-memory',
      sourceMessageIds: [],
    });
  }
  for (const candidate of input.signals.lexicalRetrievalCandidates) {
    sources.push({
      sourceType: candidate.sourceType === 'lexical' ? 'lexical' : candidate.sourceType,
      sourceId: candidate.id,
      required: candidate.required,
      reason: 'exact-match',
      sourceMessageIds: candidate.sourceMessageIds ?? [],
    });
  }
  return uniqueContextSources(sources);
}

function memoryReadsFor(input: TurnPlanningInput): MemoryReadRequirement[] {
  if (
    input.applicationState.action !== 'recall'
    && input.signals.memoryInterpretation !== 'read'
  ) {
    return [];
  }
  return input.signals.explicitMemoryCandidates
    .filter((candidate) => candidate.exact)
    .map((candidate) => ({
      memoryId: candidate.id,
      query: candidate.query,
      scope: candidate.scope,
      required: true,
    }));
}

function memoryWritesFor(input: TurnPlanningInput): MemoryWriteRequirement[] {
  if (
    input.applicationState.action !== 'remember'
    && input.signals.memoryInterpretation !== 'write'
  ) {
    return [];
  }
  const write = input.applicationState.explicitMemoryWrite;
  return write === undefined ? [] : [write];
}

function visionPlanFor(
  input: TurnPlanningInput,
  references: readonly ResolvedReference[],
  unresolved: readonly UnresolvedReference[],
): VisionExecutionPlan {
  if (unresolved.some((reference) => reference.targetType === 'image')) {
    return noVision();
  }
  const imageIds = references
    .filter((reference) => reference.targetType === 'image')
    .map((reference) => reference.targetId)
    .sort((left, right) => left.localeCompare(right));
  if (imageIds.length === 0) {
    return noVision();
  }
  if (input.applicationState.action === 'compare' && imageIds.length >= 2) {
    return { strategy: 'compare-evidence', imageReferenceIds: imageIds, evidenceIds: [] };
  }
  if (input.applicationState.action === 'inspect') {
    return { strategy: 'inspect-original', imageReferenceIds: imageIds, evidenceIds: [] };
  }
  if (
    input.applicationState.action === 'extract'
    || input.applicationState.attachedImageIds.length > 0
  ) {
    return {
      strategy: 'inspect-and-structure',
      imageReferenceIds: imageIds,
      evidenceIds: [],
    };
  }
  return { strategy: 'reuse-evidence', imageReferenceIds: imageIds, evidenceIds: [] };
}

function intentFor(input: TurnPlanningInput): TurnIntent {
  if (input.signals.intent !== undefined) {
    return input.signals.intent;
  }
  if (input.signals.memoryInterpretation === 'read') {
    return 'recall';
  }
  if (input.signals.memoryInterpretation === 'write') {
    return 'remember';
  }
  return input.applicationState.action === 'none'
    ? 'answer'
    : input.applicationState.action;
}

function modalityFor(
  input: TurnPlanningInput,
  references: readonly ResolvedReference[],
): TurnModality {
  const hasImage = references.some((reference) => reference.targetType === 'image');
  if (!hasImage) return 'text';
  return input.applicationState.attachedImageIds.length > 0 ? 'multimodal' : 'image';
}

function dependencyFor(
  input: TurnPlanningInput,
  references: readonly ResolvedReference[],
): ConversationDependency {
  const lexicalLedger = lexicalLedgerMatchesFor(input);
  const ledger =
    input.signals.activeEntityMatches.length > 0
    || input.signals.activeTopicMatches.length > 0
    || lexicalLedger.entityIds.length > 0
    || lexicalLedger.topicIds.length > 0
    || lexicalLedger.comparisonTargetIds.length > 0
    || references.some((reference) => input.ledgerState.activeImageIds.includes(reference.targetId));
  const retrieval =
    input.signals.explicitMemoryCandidates.some((candidate) => candidate.exact)
    || input.signals.lexicalRetrievalCandidates.length > 0;
  if (ledger && retrieval) return 'mixed';
  if (ledger) return 'ledger';
  if (retrieval) return 'retrieval';
  if (references.length > 0 || input.signals.recentDependency === true) return 'recent';
  return 'none';
}

function fallbackFor(
  input: TurnPlanningInput,
  unresolved: readonly UnresolvedReference[],
): SafeFallback {
  if (unresolved.length > 0) {
    return 'clarify-reference';
  }
  const usesRetrieval =
    input.signals.explicitMemoryCandidates.some((candidate) => candidate.exact)
    || input.signals.lexicalRetrievalCandidates.length > 0;
  if (usesRetrieval && input.applicationState.embeddingsAvailable !== true) {
    return 'lexical-only';
  }
  return 'execute';
}

function generationTaskFor(intent: TurnIntent): GenerationTaskKind {
  if (intent === 'compare') return 'comparison';
  if (intent === 'extract' || intent === 'inspect') return 'extraction';
  if (intent === 'clarify') return 'clarification';
  if (intent === 'continue' || intent === 'retry' || intent === 'regenerate') {
    return 'continuation';
  }
  return 'answer';
}

function constrainedGateInput(
  input: TurnPlanningInput,
  plan: TurnPlan,
): ConstrainedPlannerGateInput {
  const candidateIds = plan.unresolvedReferences.flatMap(
    (reference) => reference.candidateIds,
  );
  return {
    unresolvedFields:
      plan.unresolvedReferences.length === 0 ? [] : ['reference'],
    candidateReferenceIds: candidateIds,
    materiallyPlausibleInterpretationCount: candidateIds.length,
    ordinaryIndependentQuestion:
      plan.conversationDependency === 'none'
      && plan.modality === 'text'
      && plan.intent === 'answer',
    clearImageTurn:
      plan.unresolvedReferences.length === 0
      && plan.references.some((reference) => reference.targetType === 'image'),
    explicitMemoryWrite: plan.memoryWrites.length > 0,
    explicitMemoryRecall: plan.memoryReads.length > 0,
    action:
      input.applicationState.action === 'retry'
      || input.applicationState.action === 'regenerate'
      || input.applicationState.action === 'continue'
        ? input.applicationState.action
        : 'answer',
  };
}

function resolutionCodeFor(match: PlanningReferenceMatch): ReferenceResolutionCode {
  if (match === 'direct') return 'explicit-id';
  if (match === 'exact') return 'exact-lexical';
  if (match === 'alias') return 'unique-alias';
  return 'active-entity';
}

function sourceTypeForReference(targetType: ReferenceTargetType): ContextSourceRequirement['sourceType'] {
  if (targetType === 'image') return 'image';
  if (targetType === 'code') return 'code';
  if (targetType === 'document') return 'document';
  if (targetType === 'memory') return 'memory';
  return 'ledger';
}

function uniqueReferences(references: readonly ResolvedReference[]): ResolvedReference[] {
  const byId = new Map<string, ResolvedReference>();
  for (const reference of references) {
    byId.set(`${reference.targetType}:${reference.targetId}`, reference);
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.targetId.localeCompare(right.targetId)
      || left.targetType.localeCompare(right.targetType),
  );
}

function uniqueContextSources(
  sources: readonly ContextSourceRequirement[],
): ContextSourceRequirement[] {
  const byId = new Map<string, ContextSourceRequirement>();
  for (const source of sources) {
    byId.set(source.sourceId, source);
  }
  return [...byId.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function compareReferenceCandidates(
  left: PlanningReferenceCandidate,
  right: PlanningReferenceCandidate,
): number {
  return referenceMatchRank(left.match) - referenceMatchRank(right.match)
    || left.id.localeCompare(right.id);
}

function referenceMatchRank(match: PlanningReferenceMatch): number {
  if (match === 'direct') return 0;
  if (match === 'exact') return 1;
  if (match === 'alias') return 2;
  return 3;
}

function noVision(): VisionExecutionPlan {
  return { strategy: 'none', imageReferenceIds: [], evidenceIds: [] };
}

function lexicalLedgerMatchesFor(input: TurnPlanningInput) {
  return resolveLexicalLedgerMatches({
    userText: input.applicationState.userText ?? '',
    topics: input.ledgerState.activeTopics ?? input.ledgerState.activeTopicIds.map((id) => ({
      id,
      canonicalLabel: id,
      aliases: [],
    })),
    entities: input.ledgerState.activeEntities,
    activeComparisonTargetIds: input.ledgerState.activeComparisonTargetIds,
    directReferenceIds: input.applicationState.directReferenceIds ?? [],
    comparisonRequested: input.applicationState.action === 'compare',
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
