import type { ControlledImageTurnAudit } from '../inference/ControlledImageTurnExecutor';
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

export type VisionEvidenceDiagnosticAction =
  | 'not-produced'
  | 'reused'
  | 'freshly-inspected'
  | 'freshly-structured';

export type VisionEvidenceDiagnosticStatus =
  | 'not-applicable'
  | 'pending'
  | 'complete'
  | 'partial'
  | 'failed'
  | 'stale'
  | 'unavailable';

export interface VisionArchitectureDiagnostic {
  readonly strategy: VisionStrategy;
  readonly imageIds: readonly string[];
  readonly missingImageIds: readonly string[];
  readonly evidenceAction: VisionEvidenceDiagnosticAction;
  readonly evidenceStatus: VisionEvidenceDiagnosticStatus;
  readonly pixelsUsed: boolean;
  readonly storedEvidenceUsed: boolean;
}

export interface TurnArchitectureDiagnostics {
  readonly authorityMode: 'shadow' | 'controlled' | 'authoritative';
  readonly planOwner: string;
  readonly scenarioClass: string;
  readonly executedPlanId: string;
  readonly executedPlanVersion: string;
  readonly legacySemanticDecisionCount: number;
  readonly executedStages: readonly {
    readonly stage: string;
    readonly planId: string;
  }[];
  readonly executionResult: 'planned' | 'dispatched' | 'completed' | 'failed' | 'cancelled';
  readonly vision: VisionArchitectureDiagnostic;
  readonly shadowPlan: SanitizedTurnPlan | null;
  readonly planDelta: readonly PlanDeltaDiagnostic[];
  readonly independentRecovery: IndependentRecoveryDiagnostic;
  readonly constrainedPlanner: ConstrainedPlannerDiagnostic;
}

export function createTurnArchitectureDiagnostics(input: {
  readonly activation: PlannerActivation;
  readonly planning: TurnPlannerResult;
  readonly recovery: IndependentRoutingRecoveryResult;
  readonly scenarioClass: string;
  readonly missingImageIds?: readonly string[];
  readonly legacySemanticDecisionCount?: number;
}): TurnArchitectureDiagnostics {
  const plan = input.planning.plan;
  const legacyExecution = input.activation.semanticAuthority === 'legacy';
  return {
    authorityMode: input.activation.authorityMode,
    planOwner: input.activation.planOwner,
    scenarioClass: input.scenarioClass,
    executedPlanId: legacyExecution ? `legacy:${plan.turnId}` : plan.turnId,
    executedPlanVersion: legacyExecution ? 'legacy-routing-v1' : plan.planVersion,
    legacySemanticDecisionCount:
      input.legacySemanticDecisionCount ?? (legacyExecution ? 1 : 0),
    executedStages: [],
    executionResult: 'planned',
    vision: visionDiagnosticFor(plan, input.missingImageIds ?? []),
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
    scenarioClass: sanitizeIdentifier(diagnostics.scenarioClass),
    executedPlanId: sanitizeIdentifier(diagnostics.executedPlanId),
    executedPlanVersion: sanitizeIdentifier(diagnostics.executedPlanVersion),
    legacySemanticDecisionCount: diagnostics.legacySemanticDecisionCount,
    executedStages: diagnostics.executedStages.map((stage) => ({
      stage: sanitizeIdentifier(stage.stage),
      planId: sanitizeIdentifier(stage.planId),
    })),
    executionResult: diagnostics.executionResult,
    vision: {
      ...diagnostics.vision,
      imageIds: diagnostics.vision.imageIds.map(sanitizeIdentifier),
      missingImageIds: diagnostics.vision.missingImageIds.map(sanitizeIdentifier),
    },
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

export function withTerminalVisionEvidenceDiagnostic(
  diagnostics: TurnArchitectureDiagnostics,
  input: {
    readonly hiddenEvidencePresent: boolean;
    readonly extractionFailurePresent: boolean;
    readonly terminalStatus?: 'completed' | 'failed' | 'cancelled';
  },
): TurnArchitectureDiagnostics {
  if (diagnostics.vision.strategy !== 'inspect-and-structure') {
    return {
      ...diagnostics,
      executionResult: input.terminalStatus ?? diagnostics.executionResult,
    };
  }
  return {
    ...diagnostics,
    executionResult: input.terminalStatus ?? diagnostics.executionResult,
    vision: {
      ...diagnostics.vision,
      evidenceAction: input.hiddenEvidencePresent ? 'freshly-structured' : 'not-produced',
      evidenceStatus: input.hiddenEvidencePresent
        ? 'complete'
        : input.extractionFailurePresent
          ? 'failed'
          : 'not-applicable',
    },
  };
}

export function withControlledExecutionDiagnostic(
  diagnostics: TurnArchitectureDiagnostics,
  audit: ControlledImageTurnAudit,
): TurnArchitectureDiagnostics {
  if (audit.semanticAuthority !== diagnostics.planOwner) {
    throw new Error('Controlled execution owner diverged from architecture diagnostics.');
  }
  if (audit.stagePlanIds.some((stage) => stage.planId !== diagnostics.executedPlanId)) {
    throw new Error('Controlled execution stage used a different TurnPlan ID.');
  }
  return {
    ...diagnostics,
    legacySemanticDecisionCount: audit.legacySemanticDecisionCount,
    executedStages: audit.stagePlanIds,
    executionResult: audit.result,
    vision: {
      strategy: audit.visionStrategy,
      imageIds: [...audit.actualImageIds],
      missingImageIds: [...audit.missingImageIds],
      evidenceAction: audit.evidenceAction,
      evidenceStatus: evidenceStatusForAudit(audit),
      pixelsUsed: audit.pixelsUsed,
      storedEvidenceUsed: audit.storedEvidenceUsed,
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

function visionDiagnosticFor(
  plan: TurnPlannerResult['plan'],
  missingImageIds: readonly string[],
): VisionArchitectureDiagnostic {
  const strategy = plan.vision.strategy;
  if (strategy === 'none') {
    return {
      strategy,
      imageIds: [],
      missingImageIds: [],
      evidenceAction: 'not-produced',
      evidenceStatus: 'not-applicable',
      pixelsUsed: false,
      storedEvidenceUsed: false,
    };
  }
  if (missingImageIds.length > 0) {
    return {
      strategy,
      imageIds: [...plan.vision.imageReferenceIds],
      missingImageIds: [...missingImageIds],
      evidenceAction: 'not-produced',
      evidenceStatus: 'unavailable',
      pixelsUsed: false,
      storedEvidenceUsed: false,
    };
  }
  return {
    strategy,
    imageIds: [...plan.vision.imageReferenceIds],
    missingImageIds: [],
    evidenceAction:
      strategy === 'reuse-evidence' || strategy === 'compare-evidence'
        ? 'reused'
        : strategy === 'inspect-original'
          ? 'freshly-inspected'
          : 'freshly-structured',
    evidenceStatus:
      strategy === 'reuse-evidence' || strategy === 'compare-evidence'
        ? 'complete'
        : strategy === 'inspect-original'
          ? 'not-applicable'
          : 'pending',
    pixelsUsed: strategy === 'inspect-original' || strategy === 'inspect-and-structure',
    storedEvidenceUsed: strategy === 'reuse-evidence' || strategy === 'compare-evidence',
  };
}

function evidenceStatusForAudit(
  audit: ControlledImageTurnAudit,
): VisionEvidenceDiagnosticStatus {
  if (audit.result === 'cancelled') return 'failed';
  if (audit.evidenceStatus === 'partial') return 'partial';
  if (
    audit.evidenceStatus === 'asset-unavailable'
    || audit.evidenceStatus === 'evidence-unavailable'
    || audit.evidenceStatus === 'capability-unavailable'
  ) return 'failed';
  if (audit.evidenceAction === 'reused') return 'complete';
  if (audit.evidenceAction === 'freshly-structured') return 'pending';
  return 'not-applicable';
}

function sanitizeIdentifier(value: string): string {
  return value
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, '[local-path]')
    .replace(/\/(?:data|storage|cache|tmp|var)\/[^\s"'<>]+/g, '[local-path]')
    .replace(/[^a-zA-Z0-9:_./\-[\]]/g, '_')
    .slice(0, 160);
}
