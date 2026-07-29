import type {
  ContextSourceRequirement,
  ResolvedReference,
  TurnPlan,
  VisionExecutionPlan,
} from '../planning/types';

import type { VisionExecutionResult } from './VisionExecutor';

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
  executeVision(
    plan: VisionExecutionPlan,
    images: unknown,
    signal: AbortSignal,
  ): VisionExecutionResult;
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
  readonly stagePlanIds: readonly {
    readonly stage: ControlledImageTurnStage;
    readonly planId: string;
  }[];
  readonly contextSourceIds: readonly string[];
  readonly visionStrategy: VisionExecutionResult['strategy'];
  readonly actualImageIds: readonly string[];
  readonly missingImageIds: readonly string[];
  readonly evidenceAction: VisionExecutionResult['evidenceAction'];
  readonly evidenceStatus: VisionExecutionResult['status'];
  readonly pixelsUsed: boolean;
  readonly storedEvidenceUsed: boolean;
  readonly result: 'dispatched' | 'cancelled';
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
      return cancelledResult(plan);
    }
    const stages: ControlledImageTurnStage[] = [];

    const referencesValue = this.dependencies.resolveReferences(plan);
    stages.push('reference-resolution');
    const references = assertReferences(referencesValue, plan.references);

    const images = this.dependencies.selectImages(plan, references);
    stages.push('image-selection');
    assertImageSelection(images, plan.vision.imageReferenceIds);
    const sourcesValue = this.dependencies.selectContextSources(plan, images);
    stages.push('context-source-selection');
    const sources = assertContextSources(sourcesValue, plan.requiredContextSources);

    const context = this.dependencies.assembleContext(plan, sources);
    stages.push('context-assembly');
    const vision = this.dependencies.executeVision(plan.vision, images, signal);
    stages.push('vision-execution');
    assertVisionExecution(vision, plan.vision);
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
        stagePlanIds: stages.map((stage) => ({ stage, planId: plan.turnId })),
        contextSourceIds: sources.map((source) => source.sourceId),
        visionStrategy: vision.strategy,
        actualImageIds: vision.imageInputs.map((input) => input.imageId),
        missingImageIds: [...vision.missingImageIds],
        evidenceAction: vision.evidenceAction,
        evidenceStatus: vision.status,
        pixelsUsed: vision.imageInputs.some((input) => input.localAssetReference !== null),
        storedEvidenceUsed: vision.imageInputs.some((input) => input.evidence !== null),
        result: 'dispatched',
      },
    };
  }
}

function assertControlledImageAuthority(plan: TurnPlan): void {
  if (
    plan.authorityMode !== 'controlled'
    || !plan.planOwner.startsWith('turn-planner:')
    || (
      plan.modality === 'text'
      && !plan.unresolvedReferences.some((reference) => reference.targetType === 'image')
    )
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
  if (plannedIds.some((id) => !ids.has(id)) || ids.size !== plannedIds.length) {
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
  if (plannedIds.some((id) => !ids.has(id)) || ids.size !== plannedIds.length) {
    throw new Error('Context-source selection diverged from the authoritative TurnPlan.');
  }
  return value.filter(isContextSource);
}

function assertImageSelection(value: unknown, plannedImageIds: readonly string[]): void {
  if (!Array.isArray(value)) {
    throw new Error('Image selection did not return a deterministic image list.');
  }
  const actualIds = value.map(readImageId).filter((id): id is string => id !== null);
  if (!sameIds(actualIds, plannedImageIds)) {
    throw new Error('Image selection diverged from the authoritative TurnPlan.');
  }
}

function assertVisionExecution(
  value: VisionExecutionResult,
  planned: VisionExecutionPlan,
): void {
  if (value.strategy !== planned.strategy) {
    throw new Error('Vision strategy diverged from the authoritative TurnPlan.');
  }
  const executedIds = [
    ...value.imageInputs.map((input) => input.imageId),
    ...value.missingImageIds,
  ];
  if (!sameIds(executedIds, planned.imageReferenceIds)) {
    throw new Error('Vision image inputs diverged from the authoritative TurnPlan.');
  }
}

function readImageId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;
  if (typeof value.imageId === 'string') return value.imageId;
  if (typeof value.id === 'string') return value.id;
  return null;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const leftIds = [...new Set(left)].sort((a, b) => a.localeCompare(b));
  const rightIds = [...new Set(right)].sort((a, b) => a.localeCompare(b));
  return leftIds.length === rightIds.length
    && leftIds.every((id, index) => id === rightIds[index]);
}

function cancelledResult(plan: TurnPlan): ControlledImageTurnResult {
  return {
    answer: '',
    audit: {
      semanticAuthority: plan.planOwner,
      legacySemanticDecisionCount: 0,
      stages: [],
      stagePlanIds: [],
      contextSourceIds: [],
      visionStrategy: plan.vision.strategy,
      actualImageIds: [],
      missingImageIds: [...plan.vision.imageReferenceIds],
      evidenceAction: 'not-produced',
      evidenceStatus: 'cancelled',
      pixelsUsed: false,
      storedEvidenceUsed: false,
      result: 'cancelled',
    },
  };
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
