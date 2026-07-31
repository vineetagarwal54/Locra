import type { AuthorityMode } from './types';

export interface PlannerActivationConfig {
  readonly configuredMode: AuthorityMode;
  readonly shadowDiagnosticsEnabled: boolean;
  readonly independentRecoveryEnabled: boolean;
  readonly controlledScenarioClasses: readonly string[];
  readonly rollbackToLegacy: boolean;
  readonly legacyPlanOwner: string;
  readonly newPlanOwner: string;
}

export interface PlannerActivation {
  readonly authorityMode: AuthorityMode;
  readonly planOwner: string;
  readonly semanticAuthority: 'legacy' | 'turn-plan';
  readonly runShadowPlanner: boolean;
  readonly useLegacySemantics: boolean;
  readonly wholeTurnOwned: true;
  readonly independentRecoveryEnabled: boolean;
  readonly controlledScenarioEnabled: boolean;
}

export const DEFAULT_PLANNER_ACTIVATION: PlannerActivationConfig = {
  configuredMode: 'authoritative',
  shadowDiagnosticsEnabled: false,
  independentRecoveryEnabled: false,
  controlledScenarioClasses: [],
  rollbackToLegacy: false,
  legacyPlanOwner: 'legacy-router:v1',
  newPlanOwner: 'turn-planner:v1',
};

export function plannerActivationForRuntime(
  _isDevelopment: boolean = __DEV__,
): PlannerActivationConfig {
  return DEFAULT_PLANNER_ACTIVATION;
}

export function resolvePlannerActivation(
  config: PlannerActivationConfig,
  _scenarioClass: string,
): PlannerActivation {
  const controlledScenarioEnabled = false;
  const newPlannerOwns = !config.rollbackToLegacy;

  return {
    authorityMode: config.configuredMode,
    planOwner: newPlannerOwns ? config.newPlanOwner : config.legacyPlanOwner,
    semanticAuthority: newPlannerOwns ? 'turn-plan' : 'legacy',
    runShadowPlanner: false,
    useLegacySemantics: !newPlannerOwns,
    wholeTurnOwned: true,
    independentRecoveryEnabled: config.rollbackToLegacy
      && config.independentRecoveryEnabled,
    controlledScenarioEnabled,
  };
}
