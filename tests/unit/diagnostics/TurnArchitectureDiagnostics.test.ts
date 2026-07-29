import {
  createTurnArchitectureDiagnostics,
  sanitizeTurnArchitectureDiagnostics,
  serializeTurnArchitectureDiagnostics,
} from '../../../src/diagnostics/TurnArchitectureDiagnostics';
import {
  DEFAULT_PLANNER_ACTIVATION,
  resolvePlannerActivation,
} from '../../../src/planning/PlannerActivation';
import { TurnPlanner } from '../../../src/planning/TurnPlanner';

describe('TurnArchitectureDiagnostics', () => {
  it('records one authority mode, exact owner, plan/version, shadow delta, recovery, and Tier-3 gate', () => {
    const activation = resolvePlannerActivation({
      ...DEFAULT_PLANNER_ACTIVATION,
      configuredMode: 'shadow',
      shadowDiagnosticsEnabled: true,
    }, 'text-answer');
    const planning = new TurnPlanner().plan({
      turnId: 'turn-1',
      scenarioClass: 'text-answer',
      activation: {
        ...DEFAULT_PLANNER_ACTIVATION,
        configuredMode: 'shadow',
        shadowDiagnosticsEnabled: true,
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
      authorityMode: 'shadow',
      planOwner: 'legacy-router:v1',
      executedPlanId: 'legacy:turn-1',
      executedPlanVersion: 'legacy-routing-v1',
      shadowPlan: expect.objectContaining({ turnId: 'turn-1' }),
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
      executedPlanId: 'legacy:turn-1',
      executedPlanVersion: 'legacy-routing-v1',
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
});
