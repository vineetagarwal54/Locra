import type {
  ContextOrchestrationResult,
} from '../inference/ContextOrchestrator';
import type { ConversationFocusPlannerInput } from '../memory/ConversationStateLedger';
import type { CanonicalConversationSnapshot } from '../types/models';

import type {
  PlannerActivationConfig,
} from './PlannerActivation';
import type {
  TurnPlanner,
  PlanningAction,
} from './TurnPlanner';

export interface ShadowPlanningLifecycleInput {
  readonly snapshot: CanonicalConversationSnapshot;
  readonly orchestration: ContextOrchestrationResult;
  readonly activation: PlannerActivationConfig;
  readonly action: PlanningAction;
  readonly scenarioClass?: string;
  readonly focusLedger?: ConversationFocusPlannerInput;
}

/**
 * Obsolete compatibility entry point. Universal TurnPlanner entry makes shadow
 * semantic planning unreachable; retain the symbol until the later cleanup
 * removes callers outside this repository.
 */
export function runShadowPlanningLifecycle(
  _input: ShadowPlanningLifecycleInput,
  _planner: TurnPlanner,
): null {
  return null;
}
