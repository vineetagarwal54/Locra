import {
  ControlledImageTurnExecutor,
  type ControlledImageTurnDependencies,
} from '../../src/inference/ControlledImageTurnExecutor';
import type { VisionExecutionResult } from '../../src/inference/VisionExecutor';
import type { TurnPlan } from '../../src/planning/types';

function visionResult(
  strategy: VisionExecutionResult['strategy'] = 'inspect-original',
  imageIds: readonly string[] = ['image-1'],
): VisionExecutionResult {
  return {
    strategy,
    status: 'ready',
    imageInputs: imageIds.map((imageId) => ({
      imageId,
      sourceMessageId: `message-${imageId}`,
      localAssetReference: `/images/${imageId}.jpg`,
      evidence: null,
    })),
    missingImageIds: [],
    evidenceAction: 'freshly-inspected',
    replanned: false,
  };
}

function controlledPlan(): TurnPlan {
  return {
    planVersion: 'turn-plan-mvp-v1',
    turnId: 'turn-image-1',
    authorityMode: 'controlled',
    planOwner: 'turn-planner:v1',
    intent: 'inspect',
    modality: 'image',
    conversationDependency: 'ledger',
    references: [{
      targetType: 'image',
      targetId: 'image-1',
      resolutionCode: 'active-entity',
      confidence: 1,
      sourceMessageIds: ['message-image-1'],
      assetAvailability: 'available',
    }],
    unresolvedReferences: [],
    requiredContextSources: [{
      sourceType: 'image',
      sourceId: 'image-1',
      required: true,
      reason: 'image-required',
      sourceMessageIds: ['message-image-1'],
    }],
    memoryReads: [],
    memoryWrites: [],
    vision: {
      strategy: 'inspect-original',
      imageReferenceIds: ['image-1'],
      evidenceIds: [],
    },
    generationTaskKind: 'extraction',
    confidence: { overall: 1, unresolvedFields: [] },
    fallback: 'execute',
  };
}

describe('controlled image whole-turn authority', () => {
  it('uses one validated plan for every semantic stage and zero legacy decisions', async () => {
    const observedPlanIds: string[] = [];
    function observe<T>(value: T): T {
      observedPlanIds.push('turn-image-1');
      return value;
    }
    const dependencies: ControlledImageTurnDependencies = {
      resolveReferences: (plan) => observe(plan.references),
      selectImages: (_plan, references) => observe(references.map((item) => item.targetId)),
      selectContextSources: (plan) => observe(plan.requiredContextSources),
      assembleContext: (_plan, sources) => observe({ sources }),
      executeVision: (plan) => observe(visionResult(plan.strategy, plan.imageReferenceIds)),
      projectGeneration: (plan) => observe({ task: plan.generationTaskKind }),
      executeInference: async (plan) => observe({ planId: plan.turnId, answer: 'done' }),
    };
    const result = await new ControlledImageTurnExecutor(dependencies).execute(
      controlledPlan(),
      new AbortController().signal,
    );

    expect(result.answer).toBe('done');
    expect(result.audit.semanticAuthority).toBe('turn-planner:v1');
    expect(result.audit.legacySemanticDecisionCount).toBe(0);
    expect(result.audit.stages).toEqual([
      'reference-resolution',
      'image-selection',
      'context-source-selection',
      'context-assembly',
      'vision-execution',
      'generation-projection',
      'inference-execution',
    ]);
    expect(result.audit.stagePlanIds).toEqual(result.audit.stages.map((stage) => ({
      stage,
      planId: 'turn-image-1',
    })));
    expect(result.audit.visionStrategy).toBe('inspect-original');
    expect(result.audit.actualImageIds).toEqual(['image-1']);
    expect(new Set(observedPlanIds)).toEqual(new Set(['turn-image-1']));
  });

  it('rejects a mixed or legacy-owned plan before any stage executes', async () => {
    const stage = jest.fn();
    const dependencies: ControlledImageTurnDependencies = {
      resolveReferences: stage,
      selectImages: stage,
      selectContextSources: stage,
      assembleContext: stage,
      executeVision: stage,
      projectGeneration: stage,
      executeInference: stage,
    };

    await expect(new ControlledImageTurnExecutor(dependencies).execute({
      ...controlledPlan(),
      planOwner: 'legacy-router:v1',
    }, new AbortController().signal)).rejects.toThrow(/authority/i);
    expect(stage).not.toHaveBeenCalled();
  });

  it('fails the invariant when actual vision strategy or image IDs diverge', async () => {
    const dependencies: ControlledImageTurnDependencies = {
      resolveReferences: (plan) => plan.references,
      selectImages: () => ['image-1'],
      selectContextSources: (plan) => plan.requiredContextSources,
      assembleContext: () => ({}),
      executeVision: () => visionResult('inspect-and-structure', ['image-other']),
      projectGeneration: () => ({}),
      executeInference: async () => ({ answer: 'should not execute' }),
    };

    await expect(new ControlledImageTurnExecutor(dependencies).execute(
      controlledPlan(), new AbortController().signal,
    )).rejects.toThrow(/vision strategy diverged/i);
  });

  it('returns a cancellation audit without invoking a stage', async () => {
    const stage = jest.fn();
    const controller = new AbortController();
    controller.abort();
    const result = await new ControlledImageTurnExecutor({
      resolveReferences: stage,
      selectImages: stage,
      selectContextSources: stage,
      assembleContext: stage,
      executeVision: stage,
      projectGeneration: stage,
      executeInference: stage,
    }).execute(controlledPlan(), controller.signal);

    expect(result.audit).toEqual(expect.objectContaining({
      result: 'cancelled', legacySemanticDecisionCount: 0,
    }));
    expect(stage).not.toHaveBeenCalled();
  });
});
