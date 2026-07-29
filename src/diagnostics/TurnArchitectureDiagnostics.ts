import type {
  IndependentRecoveryKind,
  IndependentRoutingRecoveryResult,
} from '../inference/IndependentRoutingRecovery';
import type { PlannerActivation } from '../planning/PlannerActivation';
import type { TurnPlannerResult } from '../planning/TurnPlanner';
import type {
  ConversationDependency,
  GenerationTaskKind,
  SafeFallback,
  TurnIntent,
  TurnModality,
  VisionStrategy,
} from '../planning/types';

export interface SanitizedTurnPlan {
  readonly turnId: string;
  readonly planVersion: string;
  readonly intent: TurnIntent;
  readonly modality: TurnModality;
  readonly conversationDependency: ConversationDependency;
  readonly referenceIds: readonly string[];
  readonly unresolvedCandidateIds: readonly string[];
  readonly requiredContextSourceIds: readonly string[];
  readonly memoryReadIds: readonly string[];
  readonly memoryWriteIds: readonly string[];
  readonly visionStrategy: VisionStrategy;
  readonly generationTaskKind: GenerationTaskKind;
  readonly confidence: number;
  readonly fallback: SafeFallback;
}

export interface PlanDeltaDiagnostic {
  readonly field: string;
  readonly code: string;
}

export interface IndependentRecoveryDiagnostic {
  readonly enabled: boolean;
  readonly classifiedIndependent: boolean;
  readonly considered: number;
  readonly recoveredCandidateIds: readonly string[];
  readonly reasonCodes: readonly IndependentRecoveryKind[];
}

export interface ConstrainedPlannerDiagnostic {
  readonly invoked: boolean;
  readonly wouldInvoke: boolean;
  readonly gateReason: string;
  readonly queueWaitMs: number;
  readonly executionMs: number;
  readonly result: 'not-invoked' | 'accepted' | 'rejected' | 'cancelled' | 'suspended' | 'timed-out';
  readonly confidence: number | null;
  readonly fallback: SafeFallback;
}

export interface TurnArchitectureDiagnostics {
  readonly authorityMode: 'shadow' | 'controlled' | 'authoritative';
  readonly planOwner: string;
  readonly executedPlanId: string;
  readonly executedPlanVersion: string;
  readonly shadowPlan: SanitizedTurnPlan | null;
  readonly planDelta: readonly PlanDeltaDiagnostic[];
  readonly independentRecovery: IndependentRecoveryDiagnostic;
  readonly constrainedPlanner: ConstrainedPlannerDiagnostic;
}

export function createTurnArchitectureDiagnostics(input: {
  readonly activation: PlannerActivation;
  readonly planning: TurnPlannerResult;
  readonly recovery: IndependentRoutingRecoveryResult;
}): TurnArchitectureDiagnostics {
  const plan = input.planning.plan;
  const legacyExecution = input.activation.semanticAuthority === 'legacy';
  return {
    authorityMode: input.activation.authorityMode,
    planOwner: input.activation.planOwner,
    executedPlanId: legacyExecution ? `legacy:${plan.turnId}` : plan.turnId,
    executedPlanVersion: legacyExecution ? 'legacy-routing-v1' : plan.planVersion,
    shadowPlan: input.activation.runShadowPlanner ? sanitizePlan(plan) : null,
    planDelta: input.planning.validation.changes.map((change) => ({
      field: change.field,
      code: change.code,
    })),
    independentRecovery: {
      enabled: input.recovery.enabled,
      classifiedIndependent: input.recovery.classifiedIndependent,
      considered: input.recovery.considered,
      recoveredCandidateIds: input.recovery.recovered.map((candidate) => candidate.id),
      reasonCodes: [...new Set(input.recovery.recovered.map((candidate) => candidate.kind))]
        .sort((left, right) => left.localeCompare(right)),
    },
    constrainedPlanner: {
      invoked: false,
      wouldInvoke: input.planning.constrainedPlannerWouldInvoke,
      gateReason: input.planning.constrainedPlannerGate.reason,
      queueWaitMs: 0,
      executionMs: 0,
      result: 'not-invoked',
      confidence: null,
      fallback: plan.fallback,
    },
  };
}

export function sanitizeTurnArchitectureDiagnostics(
  diagnostics: TurnArchitectureDiagnostics,
): TurnArchitectureDiagnostics {
  return {
    authorityMode: diagnostics.authorityMode,
    planOwner: sanitizeIdentifier(diagnostics.planOwner),
    executedPlanId: sanitizeIdentifier(diagnostics.executedPlanId),
    executedPlanVersion: sanitizeIdentifier(diagnostics.executedPlanVersion),
    shadowPlan: diagnostics.shadowPlan === null
      ? null
      : {
          ...diagnostics.shadowPlan,
          turnId: sanitizeIdentifier(diagnostics.shadowPlan.turnId),
          planVersion: sanitizeIdentifier(diagnostics.shadowPlan.planVersion),
          referenceIds: diagnostics.shadowPlan.referenceIds.map(sanitizeIdentifier),
          unresolvedCandidateIds:
            diagnostics.shadowPlan.unresolvedCandidateIds.map(sanitizeIdentifier),
          requiredContextSourceIds:
            diagnostics.shadowPlan.requiredContextSourceIds.map(sanitizeIdentifier),
          memoryReadIds: diagnostics.shadowPlan.memoryReadIds.map(sanitizeIdentifier),
          memoryWriteIds: diagnostics.shadowPlan.memoryWriteIds.map(sanitizeIdentifier),
        },
    planDelta: diagnostics.planDelta.map((delta) => ({
      field: sanitizeIdentifier(delta.field),
      code: sanitizeIdentifier(delta.code),
    })),
    independentRecovery: {
      ...diagnostics.independentRecovery,
      recoveredCandidateIds:
        diagnostics.independentRecovery.recoveredCandidateIds.map(sanitizeIdentifier),
    },
    constrainedPlanner: {
      ...diagnostics.constrainedPlanner,
      gateReason: sanitizeIdentifier(diagnostics.constrainedPlanner.gateReason),
    },
  };
}

export function serializeTurnArchitectureDiagnostics(
  diagnostics: TurnArchitectureDiagnostics,
): string {
  return JSON.stringify(sanitizeTurnArchitectureDiagnostics(diagnostics));
}

function sanitizePlan(plan: TurnPlannerResult['plan']): SanitizedTurnPlan {
  return {
    turnId: sanitizeIdentifier(plan.turnId),
    planVersion: sanitizeIdentifier(plan.planVersion),
    intent: plan.intent,
    modality: plan.modality,
    conversationDependency: plan.conversationDependency,
    referenceIds: plan.references.map((reference) => sanitizeIdentifier(reference.targetId)),
    unresolvedCandidateIds: plan.unresolvedReferences.flatMap(
      (reference) => reference.candidateIds.map(sanitizeIdentifier),
    ),
    requiredContextSourceIds: plan.requiredContextSources.map(
      (source) => sanitizeIdentifier(source.sourceId),
    ),
    memoryReadIds: plan.memoryReads.map((read) => sanitizeIdentifier(read.memoryId)),
    memoryWriteIds: plan.memoryWrites.map((write) => sanitizeIdentifier(write.memoryId)),
    visionStrategy: plan.vision.strategy,
    generationTaskKind: plan.generationTaskKind,
    confidence: plan.confidence.overall,
    fallback: plan.fallback,
  };
}

function sanitizeIdentifier(value: string): string {
  return value
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, '[local-path]')
    .replace(/\/(?:data|storage|cache|tmp|var)\/[^\s"'<>]+/g, '[local-path]')
    .replace(/[^a-zA-Z0-9:_./\-[\]]/g, '_')
    .slice(0, 160);
}
