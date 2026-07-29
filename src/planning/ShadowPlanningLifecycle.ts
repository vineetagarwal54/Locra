import {
  createTurnArchitectureDiagnostics,
  type TurnArchitectureDiagnostics,
} from '../diagnostics/TurnArchitectureDiagnostics';
import type {
  ContextOrchestrationResult,
} from '../inference/ContextOrchestrator';
import type { IndependentRoutingRecoveryResult } from '../inference/IndependentRoutingRecovery';
import type { CanonicalConversationSnapshot } from '../types/models';

import {
  resolvePlannerActivation,
  type PlannerActivationConfig,
} from './PlannerActivation';
import {
  TurnPlanner,
  type PlanningAction,
  type PlanningReferenceCandidate,
  type TurnPlanningInput,
} from './TurnPlanner';

export interface ShadowPlanningLifecycleInput {
  readonly snapshot: CanonicalConversationSnapshot;
  readonly orchestration: ContextOrchestrationResult;
  readonly activation: PlannerActivationConfig;
  readonly action: PlanningAction;
  readonly scenarioClass?: string;
}

export function runShadowPlanningLifecycle(
  input: ShadowPlanningLifecycleInput,
  planner: TurnPlanner,
): TurnArchitectureDiagnostics | null {
  const scenarioClass = input.scenarioClass ?? scenarioClassFor(input);
  const activation = resolvePlannerActivation(input.activation, scenarioClass);
  if (
    !activation.runShadowPlanner
    && activation.semanticAuthority !== 'turn-plan'
    && !activation.independentRecoveryEnabled
  ) {
    return null;
  }
  const planning = planner.plan(buildPlanningInput(input, scenarioClass));
  return createTurnArchitectureDiagnostics({
    activation,
    planning,
    recovery: recoveryFor(input.orchestration),
  });
}

function buildPlanningInput(
  input: ShadowPlanningLifecycleInput,
  scenarioClass: string,
): TurnPlanningInput {
  const attachedImages = input.snapshot.currentMessage.attachments
    .filter((attachment) => attachment.kind === 'image')
    .map((attachment) => attachment.imageAssetId ?? attachment.path)
    .sort((left, right) => left.localeCompare(right));
  const selectedImages = input.orchestration.imageSelections
    .filter((selection) => selection.imageAssetId !== null)
    .map((selection) => selection.imageAssetId as string);
  const referenceCandidates: PlanningReferenceCandidate[] = selectedImages.map((id) => ({
    id,
    targetType: 'image',
    match: 'direct',
    materiallyPlausible: true,
    sourceMessageIds: input.orchestration.imageSelections
      .filter((selection) => selection.imageAssetId === id)
      .flatMap((selection) =>
        selection.sourceMessageId === null ? [] : [selection.sourceMessageId],
      ),
  }));
  const facts = input.orchestration.context.importantFacts.map((fact) => ({
    id: fact.id,
    sourceType: 'lexical' as const,
    required: true,
    sourceMessageIds: [fact.sourceMessageId],
  }));
  const recovery = recoveryFor(input.orchestration);

  return {
    turnId: input.snapshot.currentMessage.id,
    scenarioClass,
    activation: input.activation,
    applicationState: {
      action: input.action,
      userText: input.snapshot.currentMessage.text,
      attachedImageIds: attachedImages,
      availableImageIds: [...new Set([...attachedImages, ...selectedImages])],
      embeddingsAvailable:
        input.orchestration.diagnostics?.retrievalMode === 'fused',
    },
    ledgerState: {
      activeTopicIds: [],
      activeEntities: [],
      activeComparisonTargetIds: [],
      activeImageIds: selectedImages,
    },
    signals: {
      referenceCandidates,
      explicitMemoryCandidates: recovery.recovered
        .filter((candidate) => candidate.kind === 'explicit-memory')
        .map((candidate) => ({
          id: candidate.id,
          query: candidate.id,
          scope: 'same-chat' as const,
          exact: true,
        })),
      lexicalRetrievalCandidates: facts,
      activeTopicMatches: [],
      activeEntityMatches: recovery.recovered
        .filter((candidate) => candidate.kind === 'direct-entity')
        .map((candidate) => candidate.id),
      recentDependency:
        input.orchestration.context.recentTurns.length > 0,
    },
  };
}

function recoveryFor(
  orchestration: ContextOrchestrationResult,
): IndependentRoutingRecoveryResult {
  return orchestration.diagnostics?.independentRecovery ?? {
    enabled: false,
    classifiedIndependent: false,
    considered: 0,
    recovered: [],
  };
}

function scenarioClassFor(input: ShadowPlanningLifecycleInput): string {
  if (input.orchestration.imageSelections.length > 1) {
    return 'image-comparison';
  }
  if (
    input.snapshot.currentMessage.attachments.some(
      (attachment) => attachment.kind === 'image',
    )
  ) {
    return 'new-image';
  }
  if (input.orchestration.imageSelection !== null) {
    return 'image-follow-up';
  }
  return 'text-answer';
}
