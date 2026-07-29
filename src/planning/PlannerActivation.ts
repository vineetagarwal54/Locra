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
  configuredMode: 'shadow',
  shadowDiagnosticsEnabled: false,
  independentRecoveryEnabled: false,
  controlledScenarioClasses: [],
  rollbackToLegacy: false,
  legacyPlanOwner: 'legacy-router:v1',
  newPlanOwner: 'turn-planner:v1',
};

export function resolvePlannerActivation(
  config: PlannerActivationConfig,
  scenarioClass: string,
): PlannerActivation {
  const controlledScenarioEnabled =
    config.configuredMode === 'controlled'
    && config.controlledScenarioClasses.includes(scenarioClass);
  const newPlannerOwns =
    !config.rollbackToLegacy
    && (config.configuredMode === 'authoritative' || controlledScenarioEnabled);

  return {
    authorityMode: config.configuredMode,
    planOwner: newPlannerOwns ? config.newPlanOwner : config.legacyPlanOwner,
    semanticAuthority: newPlannerOwns ? 'turn-plan' : 'legacy',
    runShadowPlanner:
      !newPlannerOwns
      && config.configuredMode === 'shadow'
      && config.shadowDiagnosticsEnabled,
    useLegacySemantics: !newPlannerOwns,
    wholeTurnOwned: true,
    independentRecoveryEnabled:
      !newPlannerOwns
      && config.independentRecoveryEnabled,
    controlledScenarioEnabled,
  };
}
