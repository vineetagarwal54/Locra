import {
  planControlledImageTurn,
  type ControlledPlanningImage,
} from '../../../src/planning/ControlledImageTurnPlanner';
import { DEFAULT_PLANNER_ACTIVATION } from '../../../src/planning/PlannerActivation';
import { TurnPlanner } from '../../../src/planning/TurnPlanner';
import type { CanonicalConversationSnapshot } from '../../../src/types/models';

function image(
  id: string,
  createdAt: number,
  aliases: readonly string[],
  availability: 'available' | 'missing' = 'available',
): ControlledPlanningImage {
  return {
    entity: {
      id,
      conversationId: 'conversation-1',
      sourceMessageId: `message-${id}`,
      ordinal: 0,
      assetRevision: `${id}-v1`,
      assetAvailability: availability,
      localAssetReference: `/images/${id}.jpg`,
      evidenceIds: [`evidence-${id}`],
      createdAt,
      updatedAt: createdAt,
    },
    aliases,
  };
}

function snapshot(text: string): CanonicalConversationSnapshot {
  return {
    version: 'canonical-conversation-snapshot-v1',
    conversationId: 'conversation-1',
    priorMessages: [],
    currentMessage: {
      id: 'turn-1', role: 'user', text, attachments: [],
      status: 'completed', errorMessage: null, createdAt: 10,
    },
    contextMemory: null,
  };
}

const activation = {
  ...DEFAULT_PLANNER_ACTIVATION,
  configuredMode: 'controlled' as const,
  controlledScenarioClasses: ['new-image', 'image-follow-up', 'image-comparison'],
};

describe('planControlledImageTurn', () => {
  it('passes derived focus to the planner as non-authoritative input', () => {
    const planner = new TurnPlanner();
    const plan = jest.spyOn(planner, 'plan');
    planControlledImageTurn({
      snapshot: snapshot('What is visible in the image?'),
      activation,
      images: [image('fruit', 1, ['fruit'])],
      planner,
      focusLedger: {
        lastCompletedTurnId: 'turn-prior',
        activeImageIds: ['fruit'],
        lastExplicitlyReferencedImageIds: ['fruit'],
        activeAssistantMessageId: 'assistant-prior',
        activeArtifactMessageId: null,
        activeTopicLabels: [],
        activeEntityLabels: [],
        unresolvedReference: null,
      },
    });

    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      focusLedger: expect.objectContaining({
        lastCompletedTurnId: 'turn-prior',
        activeImageIds: ['fruit'],
      }),
    }));
  });

  it('resolves “their prices” to the only active image', () => {
    const result = planControlledImageTurn({
      snapshot: snapshot('What are their prices?'), activation,
      images: [image('fruit', 1, ['fruit'])],
    });
    expect(result).toEqual(expect.objectContaining({ scenarioClass: 'image-follow-up' }));
    expect(result?.planning.plan.vision).toEqual(expect.objectContaining({
      strategy: 'reuse-evidence', imageReferenceIds: ['fruit'],
    }));
  });

  it('leaves a singular pronoun unresolved when two images are plausible', () => {
    const result = planControlledImageTurn({
      snapshot: snapshot('What is its price?'), activation,
      images: [image('fruit', 1, ['fruit']), image('mattress', 2, ['mattress'])],
    });
    expect(result?.planning.plan.unresolvedReferences[0]).toEqual(expect.objectContaining({
      candidateIds: ['fruit', 'mattress'], clarificationRequired: true,
    }));
    expect(result?.planning.plan.vision.strategy).toBe('none');
  });

  it('re-inspects a resolved image when its identity exists but evidence is missing', () => {
    const failedImage = { ...image('fruit', 1, ['fruit']), evidence: null };
    const result = planControlledImageTurn({
      snapshot: snapshot('What was visible in the fruit image?'), activation,
      images: [failedImage],
    });

    expect(result?.scenarioClass).toBe('image-follow-up');
    expect(result?.planning.plan.vision).toEqual({
      strategy: 'inspect-and-structure',
      imageReferenceIds: ['fruit'],
      evidenceIds: [],
    });
  });

  it.each([
    'Compare both images.',
    'Compare the first and second images.',
    'Is there any difference between 2 images?',
    'Tell me about both images.',
    'Compare the fruit image and the mattress image.',
  ])('constructs a separated two-image comparison for “%s”', (text) => {
    const result = planControlledImageTurn({
      snapshot: snapshot(text), activation,
      images: [image('fruit', 1, ['fruit']), image('mattress', 2, ['mattress'])],
    });
    expect(result?.scenarioClass).toBe('image-comparison');
    expect(result?.planning.plan.vision).toEqual({
      strategy: 'compare-evidence',
      imageReferenceIds: ['fruit', 'mattress'],
      evidenceIds: [],
    });
    expect(result?.planning.plan.references.map((reference) => ({
      id: reference.targetId,
      source: reference.sourceMessageIds[0],
    }))).toEqual([
      { id: 'fruit', source: 'message-fruit' },
      { id: 'mattress', source: 'message-mattress' },
    ]);
  });

  it('keeps a missing comparison side in the plan', () => {
    const result = planControlledImageTurn({
      snapshot: snapshot('Compare both images.'), activation,
      images: [image('fruit', 1, ['fruit']), image('mattress', 2, ['mattress'], 'missing')],
    });
    expect(result?.planning.plan.vision.imageReferenceIds).toEqual(['fruit', 'mattress']);
    expect(result?.planning.plan.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: 'mattress', assetAvailability: 'missing' }),
    ]));
  });

  it('resolves “compare them” to the active pair without selecting a third image', () => {
    const result = planControlledImageTurn({
      snapshot: snapshot('Compare them.'), activation,
      images: [
        image('fruit', 1, ['fruit']),
        image('mattress', 2, ['mattress']),
        image('chair', 3, ['chair']),
      ],
      activeComparisonImageIds: ['fruit', 'mattress'],
    });
    expect(result?.planning.plan.vision.imageReferenceIds).toEqual(['fruit', 'mattress']);
  });

  it('uses the two obvious recent images for an unqualified two-image comparison', () => {
    const result = planControlledImageTurn({
      snapshot: snapshot('What is different between the two images?'), activation,
      images: [
        image('fruit', 1, ['fruit']),
        image('mattress-front', 2, ['mattress']),
        image('mattress-label', 3, ['mattress label']),
      ],
    });

    expect(result?.scenarioClass).toBe('image-comparison');
    expect(result?.planning.plan.vision.imageReferenceIds).toEqual([
      'mattress-front',
      'mattress-label',
    ]);
  });

  it.each([
    ['Show the first image.', 'fruit'],
    ['This is the fiest image I sent.', 'fruit'],
    ['What was in the previous image?', 'mattress-front'],
    ['What is in the latest image?', 'mattress-label'],
    ['What is in the 2nd image?', 'mattress-front'],
  ])('resolves "%s" deterministically to %s', (text, expectedId) => {
    const result = planControlledImageTurn({
      snapshot: snapshot(text), activation,
      images: [
        image('fruit', 1, ['fruit']),
        image('mattress-front', 2, ['mattress']),
        image('mattress-label', 3, ['label']),
      ],
    });

    expect(result?.scenarioClass).toBe('image-follow-up');
    expect(result?.planning.plan.vision.imageReferenceIds).toEqual([expectedId]);
  });

  it('does not silently downgrade a requested comparison when only one image is known', () => {
    const result = planControlledImageTurn({
      snapshot: snapshot('Compare both images.'), activation,
      images: [image('fruit', 1, ['fruit'])],
    });

    expect(result?.scenarioClass).toBe('image-comparison');
    expect(result?.planning.plan.vision).toEqual({
      strategy: 'none', imageReferenceIds: [], evidenceIds: [],
    });
    expect(result?.planning.plan.unresolvedReferences[0]).toEqual(
      expect.objectContaining({
        targetType: 'image',
        candidateIds: ['fruit', 'missing-comparison-side:turn-1'],
        clarificationRequired: true,
      }),
    );
    expect(result?.planning.plan.fallback).toBe('clarify-reference');
  });
});
