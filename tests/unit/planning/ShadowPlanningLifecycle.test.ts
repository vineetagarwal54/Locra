import { ContextOrchestrator } from '../../../src/inference/ContextOrchestrator';
import {
  DEFAULT_PLANNER_ACTIVATION,
} from '../../../src/planning/PlannerActivation';
import {
  runShadowPlanningLifecycle,
} from '../../../src/planning/ShadowPlanningLifecycle';
import { TurnPlanner } from '../../../src/planning/TurnPlanner';
import type { CanonicalConversationSnapshot } from '../../../src/types/models';

function snapshot(): CanonicalConversationSnapshot {
  return {
    version: 'canonical-conversation-snapshot-v1',
    conversationId: 'conversation-1',
    priorMessages: [],
    currentMessage: {
      id: 'user-1',
      role: 'user',
      text: 'What is entropy?',
      attachments: [],
      status: 'completed',
      errorMessage: null,
      createdAt: 1,
    },
    contextMemory: null,
  };
}

describe('ShadowPlanningLifecycle', () => {
  it('records a shadow plan while retaining legacy as the only execution owner', () => {
    const current = snapshot();
    const orchestration = new ContextOrchestrator().orchestrate(current, {
      diagnosticsEnabled: true,
    });
    const before = JSON.stringify(orchestration);
    const diagnostics = runShadowPlanningLifecycle({
      snapshot: current,
      orchestration,
      activation: {
        ...DEFAULT_PLANNER_ACTIVATION,
        shadowDiagnosticsEnabled: true,
      },
      action: 'answer',
    }, new TurnPlanner());

    expect(diagnostics).toEqual(expect.objectContaining({
      authorityMode: 'shadow',
      planOwner: 'legacy-router:v1',
      shadowPlan: expect.any(Object),
    }));
    expect(JSON.stringify(orchestration)).toBe(before);
  });

  it('does not run when every Wave A gate is disabled', () => {
    const current = snapshot();
    const orchestration = new ContextOrchestrator().orchestrate(current, {
      diagnosticsEnabled: true,
    });

    expect(runShadowPlanningLifecycle({
      snapshot: current,
      orchestration,
      activation: DEFAULT_PLANNER_ACTIVATION,
      action: 'answer',
    }, new TurnPlanner())).toBeNull();
  });
});
