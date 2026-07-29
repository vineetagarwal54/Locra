import type {
  ContextSourceRequirement,
  ResolvedReference,
  TurnPlan,
  VisionExecutionPlan,
} from '../planning/types';

export type ControlledImageTurnStage =
  | 'reference-resolution'
  | 'image-selection'
  | 'context-source-selection'
  | 'context-assembly'
  | 'vision-execution'
  | 'generation-projection'
  | 'inference-execution';

export interface ControlledImageTurnDependencies {
  resolveReferences(plan: TurnPlan): unknown;
  selectImages(plan: TurnPlan, references: readonly ResolvedReference[]): unknown;
  selectContextSources(plan: TurnPlan, images: unknown): unknown;
  assembleContext(plan: TurnPlan, sources: readonly ContextSourceRequirement[]): unknown;
  executeVision(plan: VisionExecutionPlan, images: unknown, signal: AbortSignal): unknown;
  projectGeneration(plan: TurnPlan, context: unknown, vision: unknown): unknown;
  executeInference(
    plan: TurnPlan,
    generation: unknown,
    signal: AbortSignal,
  ): Promise<{ readonly answer: string }>;
}

export interface ControlledImageTurnAudit {
  readonly semanticAuthority: string;
  readonly legacySemanticDecisionCount: 0;
  readonly stages: readonly ControlledImageTurnStage[];
}

export interface ControlledImageTurnResult {
  readonly answer: string;
  readonly audit: ControlledImageTurnAudit;
}

export class ControlledImageTurnExecutor {
  constructor(private readonly dependencies: ControlledImageTurnDependencies) {}

  async execute(
    plan: TurnPlan,
    signal: AbortSignal,
  ): Promise<ControlledImageTurnResult> {
    assertControlledImageAuthority(plan);
    if (signal.aborted) {
      throw new Error('Controlled image turn was cancelled.');
    }
    const stages: ControlledImageTurnStage[] = [];

    const referencesValue = this.dependencies.resolveReferences(plan);
    stages.push('reference-resolution');
    const references = assertReferences(referencesValue, plan.references);

    const images = this.dependencies.selectImages(plan, references);
    stages.push('image-selection');
    const sourcesValue = this.dependencies.selectContextSources(plan, images);
    stages.push('context-source-selection');
    const sources = assertContextSources(sourcesValue, plan.requiredContextSources);

    const context = this.dependencies.assembleContext(plan, sources);
    stages.push('context-assembly');
    const vision = this.dependencies.executeVision(plan.vision, images, signal);
    stages.push('vision-execution');
    const generation = this.dependencies.projectGeneration(plan, context, vision);
    stages.push('generation-projection');
    const inference = await this.dependencies.executeInference(plan, generation, signal);
    stages.push('inference-execution');

    return {
      answer: inference.answer,
      audit: {
        semanticAuthority: plan.planOwner,
        legacySemanticDecisionCount: 0,
        stages,
      },
    };
  }
}

function assertControlledImageAuthority(plan: TurnPlan): void {
  if (
    plan.authorityMode !== 'controlled'
    || !plan.planOwner.startsWith('turn-planner:')
    || plan.modality === 'text'
  ) {
    throw new Error('Controlled image authority requires one validated turn-planner owner.');
  }
}

function assertReferences(
  value: unknown,
  planned: readonly ResolvedReference[],
): readonly ResolvedReference[] {
  if (!Array.isArray(value)) {
    return planned;
  }
  const ids = new Set(
    value
      .filter(isResolvedReference)
      .map((reference) => `${reference.targetType}:${reference.targetId}`),
  );
  const plannedIds = planned.map(
    (reference) => `${reference.targetType}:${reference.targetId}`,
  );
  if (plannedIds.some((id) => !ids.has(id))) {
    throw new Error('Reference resolution diverged from the authoritative TurnPlan.');
  }
  return value.filter(isResolvedReference);
}

function assertContextSources(
  value: unknown,
  planned: readonly ContextSourceRequirement[],
): readonly ContextSourceRequirement[] {
  if (!Array.isArray(value)) {
    return planned;
  }
  const ids = new Set(
    value
      .filter(isContextSource)
      .map((source) => `${source.sourceType}:${source.sourceId}`),
  );
  const plannedIds = planned.map((source) => `${source.sourceType}:${source.sourceId}`);
  if (plannedIds.some((id) => !ids.has(id))) {
    throw new Error('Context-source selection diverged from the authoritative TurnPlan.');
  }
  return value.filter(isContextSource);
}

function isResolvedReference(value: unknown): value is ResolvedReference {
  return (
    isRecord(value)
    && typeof value.targetType === 'string'
    && typeof value.targetId === 'string'
  );
}

function isContextSource(value: unknown): value is ContextSourceRequirement {
  return (
    isRecord(value)
    && typeof value.sourceType === 'string'
    && typeof value.sourceId === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
