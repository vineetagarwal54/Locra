import {
  createTurnArchitectureDiagnostics,
  assertControlledTurnOwnership,
  sanitizeTurnArchitectureDiagnostics,
  serializeTurnArchitectureDiagnostics,
  withTerminalVisionEvidenceDiagnostic,
} from '../../../src/diagnostics/TurnArchitectureDiagnostics';
import {
  DEFAULT_PLANNER_ACTIVATION,
  resolvePlannerActivation,
} from '../../../src/planning/PlannerActivation';
import { TurnPlanner } from '../../../src/planning/TurnPlanner';

describe('TurnArchitectureDiagnostics', () => {
  it('rejects any legacy semantic decision attributed to a controlled turn', () => {
    expect(() => assertControlledTurnOwnership({
      authorityMode: 'controlled',
      planOwner: 'turn-planner:v1',
      scenarioClass: 'new-image',
      executedPlanId: 'turn-1',
      executedPlanVersion: 'turn-plan-mvp-v1',
      legacySemanticDecisionCount: 1,
      executedStages: [],
      executionResult: 'planned',
      vision: {
        strategy: 'inspect-and-structure',
        imageIds: ['image-1'],
        missingImageIds: [],
        evidenceAction: 'freshly-structured',
        evidenceStatus: 'pending',
      pixelsUsed: true,
      storedEvidenceUsed: false,
      imageDiagnostics: [],
      comparisonProvenance: [],
      uncertaintyOrFailureReason: null,
      },
      shadowPlan: null,
      planDelta: [],
      independentRecovery: {
        enabled: false,
        classifiedIndependent: false,
        considered: 0,
        recoveredCandidateIds: [],
        reasonCodes: [],
      },
      constrainedPlanner: {
        invoked: false,
        wouldInvoke: false,
        gateReason: 'not-needed',
        queueWaitMs: 0,
        executionMs: 0,
        result: 'not-invoked',
        confidence: null,
        fallback: 'execute',
      },
    })).toThrow(/whole-turn ownership invariant/i);
  });

  it('records one authority mode, exact owner, plan/version, recovery, and Tier-3 gate', () => {
    const activation = resolvePlannerActivation(
      DEFAULT_PLANNER_ACTIVATION,
      'independent-text',
    );
    const planning = new TurnPlanner().plan({
      turnId: 'turn-1',
      scenarioClass: 'text-answer',
      activation: {
        ...DEFAULT_PLANNER_ACTIVATION,
        configuredMode: 'authoritative',
      },
      applicationState: {
        action: 'answer',
        attachedImageIds: [],
        availableImageIds: [],
      },
      ledgerState: {
        activeTopicIds: [],
        activeEntities: [],
        activeComparisonTargetIds: [],
        activeImageIds: [],
      },
      signals: {
        referenceCandidates: [],
        explicitMemoryCandidates: [],
        lexicalRetrievalCandidates: [],
        activeTopicMatches: [],
        activeEntityMatches: [],
      },
    });
    const diagnostics = createTurnArchitectureDiagnostics({
      activation,
      planning,
      scenarioClass: 'independent-text',
      missingImageIds: [],
      legacySemanticDecisionCount: 0,
      recovery: {
        enabled: true,
        classifiedIndependent: true,
        considered: 1,
        recovered: [{
          id: 'fact-1',
          kind: 'user-fact',
          sourceMessageId: 'user-previous',
          content: 'secret rent value',
          exactOrDirect: true,
        }],
      },
    });

    expect(diagnostics).toEqual(expect.objectContaining({
      authorityMode: 'authoritative',
      planOwner: 'turn-planner:v1',
      scenarioClass: 'independent-text',
      executedPlanId: 'turn-1',
      executedPlanVersion: 'turn-plan-mvp-v1',
      legacySemanticDecisionCount: 0,
      vision: expect.objectContaining({
        strategy: 'none',
        imageIds: [],
        missingImageIds: [],
        evidenceAction: 'not-produced',
        evidenceStatus: 'not-applicable',
      }),
      shadowPlan: null,
      constrainedPlanner: expect.objectContaining({
        invoked: false,
        gateReason: expect.any(String),
      }),
      independentRecovery: expect.objectContaining({
        recoveredCandidateIds: ['fact-1'],
      }),
    }));
  });

  it('sanitizes free text, memory values, prompts, paths, and raw model identifiers', () => {
    const dirty = {
      authorityMode: 'shadow' as const,
      planOwner: 'legacy-router:v1',
      scenarioClass: 'new-image',
      executedPlanId: 'legacy:turn-1',
      executedPlanVersion: 'legacy-routing-v1',
      legacySemanticDecisionCount: 1,
      executedStages: [],
      executionResult: 'planned' as const,
      vision: {
        strategy: 'inspect-and-structure' as const,
        imageIds: ['C:\\private\\photo.jpg'],
        missingImageIds: ['missing-image'],
        evidenceAction: 'freshly-structured' as const,
        evidenceStatus: 'pending' as const,
      pixelsUsed: true,
      storedEvidenceUsed: false,
      imageDiagnostics: [],
      comparisonProvenance: [],
      uncertaintyOrFailureReason: null,
      },
      shadowPlan: {
        turnId: 'turn-1',
        planVersion: 'turn-plan-mvp-v1',
        intent: 'remember' as const,
        modality: 'text' as const,
        conversationDependency: 'none' as const,
        referenceIds: [],
        unresolvedCandidateIds: [],
        requiredContextSourceIds: [],
        memoryReadIds: [],
        memoryWriteIds: ['memory-1'],
        visionStrategy: 'none' as const,
        generationTaskKind: 'answer' as const,
        confidence: 1,
        fallback: 'execute' as const,
      },
      planDelta: [{
        field: 'memoryWrites',
        code: 'changed',
      }],
      independentRecovery: {
        enabled: true,
        classifiedIndependent: true,
        considered: 1,
        recoveredCandidateIds: ['fact-1'],
        reasonCodes: ['user-fact' as const],
      },
      constrainedPlanner: {
        invoked: false,
        wouldInvoke: false,
        gateReason: 'not-ambiguous',
        queueWaitMs: 0,
        executionMs: 0,
        result: 'not-invoked' as const,
        confidence: null,
        fallback: 'execute' as const,
      },
    };

    const sanitized = sanitizeTurnArchitectureDiagnostics(dirty);
    const serialized = serializeTurnArchitectureDiagnostics(sanitized);

    expect(serialized).not.toContain('secret rent value');
    expect(serialized).not.toContain('C:\\');
    expect(JSON.parse(serialized)).toEqual(sanitized);
  });

  it('records the terminal result of structured evidence extraction', () => {
    const diagnostics = createTurnArchitectureDiagnostics({
      activation: resolvePlannerActivation({
        ...DEFAULT_PLANNER_ACTIVATION,
        configuredMode: 'controlled',
        controlledScenarioClasses: ['new-image'],
      }, 'new-image'),
      planning: new TurnPlanner().plan({
        turnId: 'turn-image',
        scenarioClass: 'new-image',
        activation: {
          ...DEFAULT_PLANNER_ACTIVATION,
          configuredMode: 'controlled',
          controlledScenarioClasses: ['new-image'],
        },
        applicationState: {
          action: 'answer',
          attachedImageIds: ['image-1'],
          availableImageIds: ['image-1'],
        },
        ledgerState: {
          activeTopicIds: [], activeEntities: [], activeComparisonTargetIds: [], activeImageIds: [],
        },
        signals: {
          referenceCandidates: [], explicitMemoryCandidates: [], lexicalRetrievalCandidates: [],
          activeTopicMatches: [], activeEntityMatches: [],
        },
      }),
      scenarioClass: 'new-image',
      recovery: { enabled: false, classifiedIndependent: false, considered: 0, recovered: [] },
    });

    expect(withTerminalVisionEvidenceDiagnostic(diagnostics, {
      hiddenEvidencePresent: true,
      extractionFailurePresent: false,
    }).vision).toEqual(expect.objectContaining({
      evidenceAction: 'freshly-structured',
      evidenceStatus: 'complete',
    }));

    expect(withTerminalVisionEvidenceDiagnostic(diagnostics, {
      hiddenEvidencePresent: false,
      extractionFailurePresent: false,
      terminalStatus: 'cancelled',
    }).vision).toEqual(expect.objectContaining({
      evidenceAction: 'not-produced',
      evidenceStatus: 'cancelled',
    }));
  });
});
