import type { ControlledPlanningImage } from '../../../src/planning/ControlledImageTurnPlanner';
import { DEFAULT_PLANNER_ACTIVATION } from '../../../src/planning/PlannerActivation';
import {
  planUniversalTurn,
  type UniversalTurnPlanningInput,
} from '../../../src/planning/UniversalTurnPlanner';
import type { CanonicalConversationSnapshot } from '../../../src/types/models';

function snapshot(text: string, id = 'turn-current'): CanonicalConversationSnapshot {
  return {
    version: 'canonical-conversation-snapshot-v1',
    conversationId: 'conversation-1',
    priorMessages: [],
    currentMessage: {
      id,
      role: 'user',
      text,
      attachments: [],
      status: 'completed',
      errorMessage: null,
      createdAt: 100,
    },
    contextMemory: null,
  };
}

function image(id: string, createdAt: number): ControlledPlanningImage {
  return {
    entity: {
      id,
      conversationId: 'conversation-1',
      sourceMessageId: `user-${id}`,
      ordinal: createdAt,
      assetRevision: `${id}-v1`,
      assetAvailability: 'available',
      localAssetReference: `/images/${id}.jpg`,
      evidenceIds: [`evidence-${id}`],
      createdAt,
      updatedAt: createdAt,
    },
    aliases: [],
  };
}

function focus(
  overrides: Partial<NonNullable<UniversalTurnPlanningInput['focusLedger']>> = {},
): NonNullable<UniversalTurnPlanningInput['focusLedger']> {
  return {
    lastCompletedTurnId: 'user-prior',
    activeImageIds: [],
    lastExplicitlyReferencedImageIds: [],
    activeAssistantMessageId: 'assistant-prior',
    activeArtifactMessageId: null,
    activeArtifactKind: null,
    activeTopicLabels: [],
    activeEntityLabels: [],
    unresolvedReference: null,
    ...overrides,
  };
}

describe('planUniversalTurn', () => {
  it.each(['it', 'that'])(
    'supplies assistant focus and lets TurnPlanner resolve “%s”',
    (text) => {
      const result = planUniversalTurn({
        snapshot: snapshot(text),
        activation: DEFAULT_PLANNER_ACTIVATION,
        images: [],
        focusLedger: focus(),
        action: 'submit',
      });

      expect(result.planning.plan.references).toEqual([
        expect.objectContaining({
          targetType: 'message',
          targetId: 'assistant-prior',
        }),
      ]);
      expect(result.planning.plan.scenarioClass).toBe('assistant-follow-up');
    },
  );

  it('uses the active artifact for an exact code follow-up', () => {
    const result = planUniversalTurn({
      snapshot: snapshot('Explain the code you gave.'),
      activation: DEFAULT_PLANNER_ACTIVATION,
      images: [],
      focusLedger: focus({
        activeArtifactMessageId: 'assistant-code',
        activeArtifactKind: 'code',
      }),
      action: 'submit',
    });

    expect(result.planning.plan.references).toEqual([
      expect.objectContaining({
        targetType: 'code',
        targetId: 'assistant-code',
      }),
    ]);
    expect(result.planning.plan.scenarioClass).toBe('artifact-follow-up');
  });

  it('uses the active document for an exact document follow-up', () => {
    const result = planUniversalTurn({
      snapshot: snapshot('Summarize the document you gave.'),
      activation: DEFAULT_PLANNER_ACTIVATION,
      images: [],
      focusLedger: focus({
        activeArtifactMessageId: 'assistant-document',
        activeArtifactKind: 'document',
      }),
      action: 'submit',
    });

    expect(result.planning.plan.references).toEqual([
      expect.objectContaining({
        targetType: 'document',
        targetId: 'assistant-document',
      }),
    ]);
  });

  it('uses ledger image focus for an image follow-up', () => {
    const result = planUniversalTurn({
      snapshot: snapshot('What is visible in that image?'),
      activation: DEFAULT_PLANNER_ACTIVATION,
      images: [image('older', 1), image('active', 2)],
      focusLedger: focus({ activeImageIds: ['active'] }),
      action: 'submit',
    });

    expect(result.planning.plan.vision.imageReferenceIds).toEqual(['active']);
    expect(result.planning.plan.scenarioClass).toBe('image-follow-up');
  });

  it.each([
    ['Explain graph traversal.', 'graph traversal', 'topic-follow-up'],
    ['What changed for Project Atlas?', 'Project Atlas', 'entity-follow-up'],
  ] as const)('uses an exact ledger label for “%s”', (text, label, scenarioClass) => {
    const result = planUniversalTurn({
      snapshot: snapshot(text),
      activation: DEFAULT_PLANNER_ACTIVATION,
      images: [],
      focusLedger: focus(
        scenarioClass === 'topic-follow-up'
          ? { activeTopicLabels: [label] }
          : { activeEntityLabels: [label] },
      ),
      action: 'submit',
    });

    expect(result.planning.plan.scenarioClass).toBe(scenarioClass);
    expect(result.planning.plan.requiredContextSources).toEqual([
      expect.objectContaining({
        sourceType: 'ledger',
        reason: scenarioClass === 'topic-follow-up' ? 'active-topic' : 'active-entity',
      }),
    ]);
  });

  it('takes an active comparison pair only from the ledger', () => {
    const images = [image('first', 1), image('second', 2), image('third', 3)];
    const withPair = planUniversalTurn({
      snapshot: snapshot('Compare them.'),
      activation: DEFAULT_PLANNER_ACTIVATION,
      images,
      focusLedger: focus({ activeImageIds: ['first', 'second'] }),
      action: 'submit',
    });
    const withoutPair = planUniversalTurn({
      snapshot: snapshot('Compare them.'),
      activation: DEFAULT_PLANNER_ACTIVATION,
      images,
      focusLedger: focus({ activeImageIds: ['third'] }),
      action: 'submit',
    });

    expect(withPair.planning.plan.vision.imageReferenceIds).toEqual(['first', 'second']);
    expect(withoutPair.planning.plan.vision.imageReferenceIds).toEqual([]);
    expect(withoutPair.planning.plan.fallback).toBe('clarify-reference');
  });

  it('clarifies a ledger-owned unresolved reference without legacy fallback', () => {
    const result = planUniversalTurn({
      snapshot: snapshot('What is its price?'),
      activation: DEFAULT_PLANNER_ACTIVATION,
      images: [image('first', 1), image('second', 2)],
      focusLedger: focus({
        unresolvedReference: {
          targetType: 'image',
          candidateIds: ['first', 'second'],
          sourceMessageId: 'user-prior',
        },
      }),
      action: 'submit',
    });

    expect(result.planning.plan.unresolvedReferences).toEqual([
      expect.objectContaining({
        targetType: 'image',
        candidateIds: ['first', 'second'],
        clarificationRequired: true,
      }),
    ]);
    expect(result.planning.plan.fallback).toBe('clarify-reference');
    expect(result.planning.plan.planOwner).toBe('turn-planner:v1');
  });

  it.each([
    ['retry', 'retry'],
    ['regenerate', 'regenerate'],
    ['continue', 'continue'],
  ] as const)(
    'preserves the original turn ID and focus for %s',
    (action, expectedIntent) => {
      const result = planUniversalTurn({
        snapshot: snapshot('What is visible in that image?', 'user-original'),
        activation: DEFAULT_PLANNER_ACTIVATION,
        images: [image('active', 1)],
        focusLedger: focus({ activeImageIds: ['active'] }),
        action,
      });

      expect(result.planning.plan.turnId).toBe('user-original');
      expect(result.planning.plan.intent).toBe(expectedIntent);
      expect(result.planning.plan.vision.imageReferenceIds).toEqual(['active']);
    },
  );
});
