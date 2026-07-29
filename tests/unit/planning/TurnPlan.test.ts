import { resolveLexicalLedgerMatches } from '../../../src/planning/LexicalPlanningSignals';
import { validateTurnPlan } from '../../../src/planning/TurnPlanValidator';
import {
  TURN_PLAN_VERSION,
  type TurnPlan,
} from '../../../src/planning/types';

function validTextPlan(): TurnPlan {
  return {
    planVersion: TURN_PLAN_VERSION,
    turnId: 'turn-1',
    authorityMode: 'authoritative',
    planOwner: 'turn-planner:v1',
    intent: 'answer',
    modality: 'text',
    conversationDependency: 'none',
    references: [],
    unresolvedReferences: [],
    requiredContextSources: [],
    memoryReads: [],
    memoryWrites: [],
    vision: {
      strategy: 'none',
      imageReferenceIds: [],
      evidenceIds: [],
    },
    generationTaskKind: 'answer',
    confidence: {
      overall: 0.95,
      unresolvedFields: [],
    },
    fallback: 'execute',
  };
}

describe('TurnPlan validation', () => {
  it('accepts every required MVP field without later enrichment', () => {
    const result = validateTurnPlan(validTextPlan());

    expect(result.valid).toBe(true);
    expect(result.plan).toEqual(validTextPlan());
    expect(result.changes).toEqual([]);
  });

  it('keeps an ambiguous image unresolved and never selects pixels or evidence', () => {
    const plan: TurnPlan = {
      ...validTextPlan(),
      modality: 'image',
      references: [{
        targetType: 'image',
        targetId: 'image-a',
        resolutionCode: 'active-entity',
        confidence: 0.55,
        sourceMessageIds: ['message-a'],
        assetAvailability: 'available',
      }],
      unresolvedReferences: [{
        targetType: 'image',
        candidateIds: ['image-a', 'image-b'],
        reason: 'multiple-plausible-candidates',
        clarificationRequired: true,
      }],
      vision: {
        strategy: 'inspect-original',
        imageReferenceIds: ['image-a'],
        evidenceIds: [],
      },
    };

    const result = validateTurnPlan(plan);

    expect(result.valid).toBe(true);
    expect(result.plan.references).toEqual([]);
    expect(result.plan.vision.strategy).toBe('none');
    expect(result.plan.fallback).toBe('clarify-reference');
    expect(result.plan.generationTaskKind).toBe('clarification');
  });

  it('does not silently turn an image-required plan into text-only execution', () => {
    const result = validateTurnPlan({
      ...validTextPlan(),
      modality: 'image',
      vision: {
        strategy: 'inspect-original',
        imageReferenceIds: [],
        evidenceIds: [],
      },
    });

    expect(result.plan.fallback).toBe('asset-unavailable');
    expect(result.plan.generationTaskKind).toBe('clarification');
    expect(result.plan.vision.strategy).toBe('none');
  });

  it('rejects an uncertain durable memory write', () => {
    const result = validateTurnPlan({
      ...validTextPlan(),
      intent: 'remember',
      memoryWrites: [{
        memoryId: 'memory-1',
        scope: 'durable',
        explicitUserCommand: false,
        sourceMessageId: 'user-1',
        confidence: 0.6,
        fact: {
          subject: 'user',
          predicate: 'rent',
          value: '$1,689',
          verbatimText: 'My rent is $1,689.',
        },
      }],
    });

    expect(result.plan.memoryWrites).toEqual([]);
    expect(result.plan.generationTaskKind).toBe('clarification');
    expect(result.plan.fallback).toBe('clarify-reference');
    expect(result.changes).toContainEqual(expect.objectContaining({
      code: 'uncertain-durable-memory-write-removed',
    }));
  });

  it('uses capability fallback when a provider cannot inspect required pixels', () => {
    const result = validateTurnPlan(
      {
        ...validTextPlan(),
        modality: 'multimodal',
        references: [{
          targetType: 'image',
          targetId: 'image-a',
          resolutionCode: 'attachment',
          confidence: 1,
          sourceMessageIds: ['user-1'],
          assetAvailability: 'available',
        }],
        vision: {
          strategy: 'inspect-and-structure',
          imageReferenceIds: ['image-a'],
          evidenceIds: [],
        },
      },
      { supportsImageInput: false, supportsStructuredExtraction: false },
    );

    expect(result.plan.fallback).toBe('capability-unavailable');
    expect(result.plan.vision.strategy).toBe('none');
  });
});

describe('lexical-only ledger matching', () => {
  it('uses identities, canonical labels, aliases, code IDs, direct references, and comparison state', () => {
    const matches = resolveLexicalLedgerMatches({
      userText: 'Compare apartment rent with algo_recursive.',
      topics: [{
        id: 'housing-topic',
        canonicalLabel: 'apartment',
        aliases: ['lease'],
      }],
      entities: [{
        id: 'rent-entity',
        canonicalLabel: 'monthly rent',
        aliases: ['rent'],
      }],
      activeComparisonTargetIds: ['algo_recursive', 'algo_iterative'],
      directReferenceIds: ['algo_iterative'],
      comparisonRequested: true,
    });

    expect(matches).toEqual({
      topicIds: ['housing-topic'],
      entityIds: ['rent-entity'],
      comparisonTargetIds: ['algo_iterative', 'algo_recursive'],
    });
  });
});
