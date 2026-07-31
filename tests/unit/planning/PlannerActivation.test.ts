import {
  DEFAULT_PLANNER_ACTIVATION,
  plannerActivationForRuntime,
  resolvePlannerActivation,
} from '../../../src/planning/PlannerActivation';

describe('PlannerActivation', () => {
  it('ignores obsolete shadow gates and gives the whole turn to TurnPlanner', () => {
    const result = resolvePlannerActivation({
      ...DEFAULT_PLANNER_ACTIVATION,
      configuredMode: 'shadow',
      shadowDiagnosticsEnabled: true,
    }, 'text-answer');

    expect(result.planOwner).toBe('turn-planner:v1');
    expect(result.semanticAuthority).toBe('turn-plan');
    expect(result.runShadowPlanner).toBe(false);
    expect(result.useLegacySemantics).toBe(false);
  });

  it('gives a named controlled class whole-turn ownership', () => {
    const result = resolvePlannerActivation({
      ...DEFAULT_PLANNER_ACTIVATION,
      configuredMode: 'controlled',
      controlledScenarioClasses: ['image-reinspection'],
    }, 'image-reinspection');

    expect(result.planOwner).toBe('turn-planner:v1');
    expect(result.semanticAuthority).toBe('turn-plan');
    expect(result.wholeTurnOwned).toBe(true);
    expect(result.useLegacySemantics).toBe(false);
  });

  it('does not use a controlled-class allowlist as a planner gate', () => {
    const result = resolvePlannerActivation({
      ...DEFAULT_PLANNER_ACTIVATION,
      configuredMode: 'controlled',
      controlledScenarioClasses: ['image-reinspection'],
    }, 'image-comparison');

    expect(result.planOwner).toBe('turn-planner:v1');
    expect(result.semanticAuthority).toBe('turn-plan');
    expect(result.wholeTurnOwned).toBe(true);
  });

  it('bypasses legacy semantics in authoritative mode', () => {
    const result = resolvePlannerActivation({
      ...DEFAULT_PLANNER_ACTIVATION,
      configuredMode: 'authoritative',
    }, 'text-answer');

    expect(result.planOwner).toBe('turn-planner:v1');
    expect(result.useLegacySemantics).toBe(false);
  });

  it('rolls back the whole turn to one legacy owner', () => {
    const result = resolvePlannerActivation({
      ...DEFAULT_PLANNER_ACTIVATION,
      configuredMode: 'authoritative',
      rollbackToLegacy: true,
    }, 'image-reinspection');

    expect(result.planOwner).toBe('legacy-router:v1');
    expect(result.semanticAuthority).toBe('legacy');
    expect(result.wholeTurnOwned).toBe(true);
    expect(result.useLegacySemantics).toBe(true);
  });

  it('uses universal authoritative entry in development', () => {
    expect(plannerActivationForRuntime(true)).toBe(DEFAULT_PLANNER_ACTIVATION);
  });

  it('returns the unchanged default activation in release builds', () => {
    expect(plannerActivationForRuntime(false)).toBe(DEFAULT_PLANNER_ACTIVATION);
  });
});
