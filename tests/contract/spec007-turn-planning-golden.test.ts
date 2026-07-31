import {
  DEFAULT_PLANNER_ACTIVATION,
} from '../../src/planning/PlannerActivation';
import {
  TurnPlanner,
  type TurnPlanningInput,
} from '../../src/planning/TurnPlanner';

interface GoldenFixture {
  readonly id: string;
  readonly input: TurnPlanningInput;
  readonly expected: {
    readonly intent: string;
    readonly dependency: string;
    readonly fallback: string;
    readonly visionStrategy: string;
    readonly contextSourceIds: readonly string[];
  };
}

function baseInput(turnId: string): TurnPlanningInput {
  return {
    turnId,
    scenarioClass: 'golden',
    activation: {
      ...DEFAULT_PLANNER_ACTIVATION,
      configuredMode: 'authoritative',
    },
    applicationState: {
      action: 'answer',
      attachedImageIds: [],
      availableImageIds: [],
    },
    ledgerState: {
      activeTopicIds: [],
      activeEntities: [],
      activeComparisonTargetIds: [],
      activeImageIds: [],
    },
    signals: {
      referenceCandidates: [],
      explicitMemoryCandidates: [],
      lexicalRetrievalCandidates: [],
      activeTopicMatches: [],
      activeEntityMatches: [],
    },
  };
}

const GOLDENS: readonly GoldenFixture[] = [
  {
    id: 'GV-001',
    input: {
      ...baseInput('gv-001'),
      applicationState: {
        ...baseInput('gv-001').applicationState,
        action: 'compare',
      },
      ledgerState: {
        ...baseInput('gv-001').ledgerState,
        activeComparisonTargetIds: ['code-recursive', 'code-iterative'],
      },
      signals: {
        ...baseInput('gv-001').signals,
        lexicalRetrievalCandidates: [
          { id: 'code-recursive', sourceType: 'code', required: true },
          { id: 'code-iterative', sourceType: 'code', required: true },
        ],
      },
    },
    expected: {
      intent: 'compare',
      dependency: 'mixed',
      fallback: 'lexical-only',
      visionStrategy: 'none',
      contextSourceIds: ['code-iterative', 'code-recursive'],
    },
  },
  {
    id: 'GV-002',
    input: {
      ...baseInput('gv-002'),
      applicationState: {
        ...baseInput('gv-002').applicationState,
        action: 'recall',
      },
      signals: {
        ...baseInput('gv-002').signals,
        explicitMemoryCandidates: [{
          id: 'memory-rent',
          query: 'rent',
          scope: 'same-chat',
          exact: true,
        }],
      },
    },
    expected: {
      intent: 'recall',
      dependency: 'retrieval',
      fallback: 'lexical-only',
      visionStrategy: 'none',
      contextSourceIds: ['memory-rent'],
    },
  },
  {
    id: 'GV-003',
    input: {
      ...baseInput('gv-003'),
      ledgerState: {
        ...baseInput('gv-003').ledgerState,
        activeEntities: [{
          id: 'product-apples',
          canonicalLabel: 'apples',
          aliases: ['apple'],
        }],
        activeImageIds: ['market-image'],
      },
      signals: {
        ...baseInput('gv-003').signals,
        referenceCandidates: [{
          id: 'market-image',
          targetType: 'image',
          match: 'active',
          materiallyPlausible: true,
          sourceMessageIds: ['market-message'],
        }],
        activeEntityMatches: ['product-apples'],
      },
    },
    expected: {
      intent: 'answer',
      dependency: 'ledger',
      fallback: 'execute',
      visionStrategy: 'reuse-evidence',
      contextSourceIds: ['market-image', 'product-apples', 'market-message'],
    },
  },
  {
    id: 'GV-004',
    input: {
      ...baseInput('gv-004'),
      applicationState: {
        action: 'inspect',
        attachedImageIds: [],
        availableImageIds: ['market-image'],
      },
      ledgerState: {
        ...baseInput('gv-004').ledgerState,
        activeImageIds: ['market-image'],
      },
      signals: {
        ...baseInput('gv-004').signals,
        referenceCandidates: [{
          id: 'market-image',
          targetType: 'image',
          match: 'direct',
          materiallyPlausible: true,
          sourceMessageIds: ['market-message'],
        }],
      },
    },
    expected: {
      intent: 'inspect',
      dependency: 'ledger',
      fallback: 'execute',
      visionStrategy: 'inspect-original',
      contextSourceIds: ['market-image', 'market-message'],
    },
  },
  {
    id: 'GV-005',
    input: {
      ...baseInput('gv-005'),
      applicationState: {
        action: 'compare',
        attachedImageIds: [],
        availableImageIds: ['image-a', 'image-b'],
      },
      signals: {
        ...baseInput('gv-005').signals,
        referenceCandidates: [
          {
            id: 'image-a',
            targetType: 'image',
            match: 'direct',
            materiallyPlausible: true,
            sourceMessageIds: ['message-a'],
          },
          {
            id: 'image-b',
            targetType: 'image',
            match: 'direct',
            materiallyPlausible: true,
            sourceMessageIds: ['message-b'],
          },
        ],
      },
    },
    expected: {
      intent: 'compare',
      dependency: 'recent',
      fallback: 'execute',
      visionStrategy: 'compare-evidence',
      contextSourceIds: ['image-a', 'image-b', 'message-a', 'message-b'],
    },
  },
  {
    id: 'GV-006',
    input: baseInput('gv-006'),
    expected: {
      intent: 'answer',
      dependency: 'none',
      fallback: 'execute',
      visionStrategy: 'none',
      contextSourceIds: [],
    },
  },
  {
    id: 'GV-007',
    input: {
      ...baseInput('gv-007'),
      applicationState: {
        ...baseInput('gv-007').applicationState,
        mainProviderDescriptor: 'replacement-provider',
      },
    },
    expected: {
      intent: 'answer',
      dependency: 'none',
      fallback: 'execute',
      visionStrategy: 'none',
      contextSourceIds: [],
    },
  },
  {
    id: 'GV-008',
    input: {
      ...baseInput('gv-008'),
      applicationState: {
        ...baseInput('gv-008').applicationState,
        embeddingsAvailable: false,
      },
      signals: {
        ...baseInput('gv-008').signals,
        lexicalRetrievalCandidates: [{
          id: 'exact-unit-3427-014',
          sourceType: 'memory',
          required: true,
        }],
      },
    },
    expected: {
      intent: 'answer',
      dependency: 'retrieval',
      fallback: 'lexical-only',
      visionStrategy: 'none',
      contextSourceIds: ['exact-unit-3427-014'],
    },
  },
  {
    id: 'GV-009',
    input: {
      ...baseInput('gv-009'),
      applicationState: {
        ...baseInput('gv-009').applicationState,
        action: 'none',
      },
      signals: {
        ...baseInput('gv-009').signals,
        memoryInterpretation: 'neither',
      },
    },
    expected: {
      intent: 'answer',
      dependency: 'none',
      fallback: 'execute',
      visionStrategy: 'none',
      contextSourceIds: [],
    },
  },
];

describe('Spec 007 Wave A deterministic golden planning', () => {
  it.each(GOLDENS)('$id produces the expected plan without constrained planning', (fixture) => {
    const result = new TurnPlanner().plan(fixture.input);

    expect(result.plan).toEqual(expect.objectContaining({
      authorityMode: 'authoritative',
      intent: fixture.expected.intent,
      conversationDependency: fixture.expected.dependency,
      fallback: fixture.expected.fallback,
      vision: expect.objectContaining({ strategy: fixture.expected.visionStrategy }),
    }));
    expect(result.plan.requiredContextSources.map((source) => source.sourceId))
      .toEqual(fixture.expected.contextSourceIds);
    expect(result.constrainedPlannerInvoked).toBe(false);
  });
});
