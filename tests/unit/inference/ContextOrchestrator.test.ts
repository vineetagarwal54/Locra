import { readFileSync } from 'fs';
import { join } from 'path';

import {
  CharacterContextBudgetPolicy,
  ContextOrchestrator,
  createCanonicalConversationSnapshot,
  mergeMediaEvidenceIntoMemory,
  mergeVisualEvidenceIntoMemory,
} from '../../../src/inference/ContextOrchestrator';
import type { HiddenVisualEvidence } from '../../../src/inference/OutputPipelineTypes';
import type {
  Conversation,
  ConversationContextMemory,
  ConversationMessage,
} from '../../../src/types/models';

function completedTurn(
  index: number,
  question: string,
  answer: string,
  imagePath: string | null = null,
): ConversationMessage[] {
  return [
    {
      id: `user-${index}`,
      role: 'user',
      text: question,
      attachments: imagePath === null ? [] : [{ kind: 'image', path: imagePath }],
      status: 'completed',
      errorMessage: null,
      createdAt: 1_700_000_000_000 + index * 2,
    },
    {
      id: `assistant-${index}`,
      role: 'assistant',
      text: answer,
      attachments: [],
      status: 'completed',
      errorMessage: null,
      createdAt: 1_700_000_000_001 + index * 2,
    },
  ];
}

function currentMessage(index: number, text: string): ConversationMessage {
  return {
    id: `user-${index}`,
    role: 'user',
    text,
    attachments: [],
    status: 'completed',
    errorMessage: null,
    createdAt: 1_700_000_000_000 + index * 2,
  };
}

function conversation(
  messages: ConversationMessage[],
  contextMemory?: ConversationContextMemory | null,
  id = 'conversation-a',
): Conversation {
  return {
    id,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000 + messages.length,
    messages,
    status: 'completed',
    errorMessage: null,
    metrics: null,
    flagged: false,
    flagNote: null,
    contextMemory,
  };
}

function visualEvidence(
  imagePath: string,
  subjectObject: string,
  visibleText: string[] = [],
): HiddenVisualEvidence {
  return {
    version: 'hidden-evidence-v1',
    imagePath,
    sourceQuestion: 'Inspect this image.',
    subjectObject,
    visibleFeatures: [`${subjectObject} feature`],
    visibleText,
    visibleCondition: `${subjectObject} condition`,
    uncertainty: [],
    createdAt: '2026-07-10T12:00:00.000Z',
  };
}

function compactPolicy(overrides: {
  maximumUnits?: number;
  recentExactTurnLimit?: number;
  maxMediaEvidenceItems?: number;
  maxFactItems?: number;
  maxSummaryEntries?: number;
} = {}): CharacterContextBudgetPolicy {
  return new CharacterContextBudgetPolicy({
    maximumUnits: 4_000,
    recentExactTurnLimit: 2,
    maxMediaEvidenceItems: 2,
    maxFactItems: 4,
    maxSummaryEntries: 4,
    ...overrides,
  });
}

describe('ContextOrchestrator', () => {
  it('stays pure and independent of storage, networking, and model execution', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/ContextOrchestrator.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/from ['"].*(storage|history|store)\//i);
    expect(source).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|useLLM|generate)\b/);
  });

  it('keeps recent completed turns verbatim and rolls older turns into derived memory', () => {
    const messages = [
      ...completedTurn(1, 'Question one', 'Answer one'),
      ...completedTurn(2, 'Question two', 'Answer two'),
      ...completedTurn(3, 'Question three', 'Answer three'),
      ...completedTurn(4, 'Question four', 'Answer four'),
      currentMessage(5, 'Continue from the plan.'),
    ];
    const source = conversation(messages);
    const originalMessages = JSON.parse(JSON.stringify(source.messages));
    const orchestrator = new ContextOrchestrator(compactPolicy());

    const result = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(source, 'user-5'),
    );

    expect(result.context.recentTurns).toEqual([
      { question: 'Question three', answer: 'Answer three' },
      { question: 'Question four', answer: 'Answer four' },
    ]);
    expect(result.memory.version).toBe('conversation-context-memory-v1');
    expect(result.memory.rollingSummary?.version).toBe('rolling-summary-v1');
    expect(result.memory.rollingSummary?.entries.map((entry) => entry.sourceUserMessageId)).toEqual([
      'user-1',
      'user-2',
    ]);
    expect(result.context.olderSummary).toMatch(/Question one|Question two/);
    expect(source.messages).toEqual(originalMessages);
  });

  it('selects prior media evidence by deterministic relevance before recency', () => {
    const messages = [
      ...completedTurn(1, 'Inspect the label.', 'The label is readable.', '/images/label.jpg'),
      ...completedTurn(2, 'Inspect the chair.', 'The chair is wooden.', '/images/chair.jpg'),
      currentMessage(3, 'Which serial code was visible on the label?'),
    ];
    let memory = mergeVisualEvidenceIntoMemory(
      null,
      visualEvidence('/images/label.jpg', 'equipment label', ['Serial code ZX-418']),
      'user-1',
    );
    memory = mergeVisualEvidenceIntoMemory(
      memory,
      visualEvidence('/images/chair.jpg', 'wooden chair'),
      'user-2',
    );
    const orchestrator = new ContextOrchestrator(
      compactPolicy({ recentExactTurnLimit: 1, maxMediaEvidenceItems: 1 }),
    );

    const result = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(messages, memory), 'user-3'),
    );

    expect(result.context.mediaEvidence).toHaveLength(1);
    expect(result.context.mediaEvidence[0]).toEqual(
      expect.objectContaining({
        sourceMessageId: 'user-1',
        summary: 'equipment label',
        extractedText: ['Serial code ZX-418'],
      }),
    );
  });

  it('selects relevant older facts and decisions without phrase-specific routing', () => {
    const messages = [
      ...completedTurn(
        1,
        'Set the backup policy.',
        'The backup schedule is nightly, with a thirty-day retention window.',
      ),
      ...completedTurn(2, 'Choose the theme.', 'The interface will use the light theme.'),
      ...completedTurn(3, 'Pick an icon.', 'Use the existing application icon.'),
      currentMessage(4, 'What retention window did we choose for backups?'),
    ];
    const orchestrator = new ContextOrchestrator(
      compactPolicy({ recentExactTurnLimit: 1, maxFactItems: 1 }),
    );

    const result = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-4'),
    );

    expect(result.context.importantFacts).toHaveLength(1);
    expect(result.context.importantFacts[0]?.text).toContain('thirty-day retention window');
  });

  it('uses a replaceable budget policy and records bounded selection metadata', () => {
    const messages = [
      ...completedTurn(1, 'Earlier topic', 'Earlier answer with useful detail.'),
      ...completedTurn(2, 'Recent topic', 'Recent answer with useful detail.'),
      currentMessage(3, 'Continue the recent topic.'),
    ];
    const policy = compactPolicy({
      maximumUnits: 550,
      recentExactTurnLimit: 1,
      maxFactItems: 1,
      maxSummaryEntries: 1,
    });

    const result = new ContextOrchestrator(policy).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-3'),
    );

    expect(result.context.budget.policyId).toBe('character-budget-v1');
    expect(result.context.budget.maximumUnits).toBe(550);
    expect(result.context.budget.usedUnits).toBeLessThanOrEqual(550);
    expect(policy.measure('four')).toBe(4);
  });

  it('isolates snapshots from later conversation and memory mutations', () => {
    const messages = [
      ...completedTurn(1, 'Original question', 'Original answer'),
      currentMessage(2, 'Continue.'),
    ];
    const source = conversation(messages);
    const snapshot = createCanonicalConversationSnapshot(source, 'user-2');

    source.messages[0].text = 'Mutated question';
    source.contextMemory = mergeVisualEvidenceIntoMemory(
      null,
      visualEvidence('/images/late.jpg', 'late mutation'),
      'user-1',
    );

    const result = new ContextOrchestrator(compactPolicy()).orchestrate(snapshot);

    expect(result.context.recentTurns[0]?.question).toBe('Original question');
    expect(result.context.mediaEvidence).toEqual([]);
  });

  it('filters derived evidence whose source message does not belong to the snapshot', () => {
    const messages = [
      ...completedTurn(1, 'Conversation A question', 'Conversation A answer'),
      currentMessage(2, 'Continue conversation A.'),
    ];
    const foreignMemory = mergeVisualEvidenceIntoMemory(
      null,
      visualEvidence('/images/foreign.jpg', 'foreign object'),
      'user-from-conversation-b',
    );

    const result = new ContextOrchestrator(compactPolicy()).orchestrate(
      createCanonicalConversationSnapshot(
        conversation(messages, foreignMemory, 'conversation-a'),
        'user-2',
      ),
    );

    expect(result.context.mediaEvidence).toEqual([]);
    expect(result.memory.mediaEvidence).toEqual([]);
  });

  it('accepts generic document evidence through the same derived-memory contract', () => {
    const messages = [
      ...completedTurn(1, 'Review the attachment.', 'The attachment was processed.'),
      currentMessage(2, 'What deadline did the document state?'),
    ];
    const memory = mergeMediaEvidenceIntoMemory(null, {
      version: 'context-media-evidence-v1',
      id: 'user-1:document',
      sourceMessageId: 'user-1',
      modality: 'document',
      sourcePath: '/documents/plan.pdf',
      summary: 'project plan',
      facts: ['delivery schedule'],
      extractedText: ['Deadline: September 30'],
      uncertainty: [],
      createdAt: 1_700_000_000_000,
    });

    const result = new ContextOrchestrator(compactPolicy()).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages, memory), 'user-2'),
    );

    expect(result.context.mediaEvidence[0]).toEqual(
      expect.objectContaining({
        modality: 'document',
        extractedText: ['Deadline: September 30'],
      }),
    );
  });

  it('advances the rolling summary boundary as completed turns age out of the exact window', () => {
    const firstMessages = [
      ...completedTurn(1, 'First question', 'First answer'),
      ...completedTurn(2, 'Second question', 'Second answer'),
      ...completedTurn(3, 'Third question', 'Third answer'),
      currentMessage(4, 'Continue.'),
    ];
    const orchestrator = new ContextOrchestrator(compactPolicy({ recentExactTurnLimit: 2 }));
    const firstResult = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(firstMessages), 'user-4'),
    );
    const nextMessages = [
      ...firstMessages.slice(0, -1),
      ...completedTurn(4, 'Fourth question', 'Fourth answer'),
      currentMessage(5, 'Continue again.'),
    ];

    const nextResult = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(
        conversation(nextMessages, firstResult.memory),
        'user-5',
      ),
    );

    expect(firstResult.memory.rollingSummary?.entries).toHaveLength(1);
    expect(nextResult.memory.rollingSummary?.entries).toHaveLength(2);
    expect(nextResult.memory.rollingSummary?.coveredThroughMessageId).toBe('assistant-2');
  });

  it('omits diagnostics entirely when diagnosticsEnabled is false', () => {
    const messages = [
      ...completedTurn(1, 'Question one', 'Answer one'),
      currentMessage(2, 'Continue.'),
    ];

    const result = new ContextOrchestrator(compactPolicy()).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-2'),
      { diagnosticsEnabled: false },
    );

    expect(result.diagnostics).toBeUndefined();
  });

  it('reports selected recent turns with source ids and cost when diagnostics are enabled', () => {
    const messages = [
      ...completedTurn(1, 'Question one', 'Answer one'),
      ...completedTurn(2, 'Question two', 'Answer two'),
      currentMessage(3, 'Continue.'),
    ];

    const result = new ContextOrchestrator(compactPolicy({ recentExactTurnLimit: 2 })).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-3'),
      { diagnosticsEnabled: true },
    );

    expect(result.diagnostics?.recentTurnsConsidered).toBe(2);
    expect(result.diagnostics?.recentTurnsSelected).toEqual([
      expect.objectContaining({ sourceUserMessageId: 'user-1', sourceAssistantMessageId: 'assistant-1' }),
      expect.objectContaining({ sourceUserMessageId: 'user-2', sourceAssistantMessageId: 'assistant-2' }),
    ]);
    expect(result.diagnostics?.recentTurnsSelected.every((turn) => turn.costUnits > 0)).toBe(true);
    expect(result.diagnostics?.budget).toEqual(result.context.budget);
  });

  it('marks excluded media evidence candidates with a budget or item-cap reason', () => {
    const messages = [
      ...completedTurn(1, 'Inspect the label.', 'The label is readable.', '/images/label.jpg'),
      ...completedTurn(2, 'Inspect the chair.', 'The chair is wooden.', '/images/chair.jpg'),
      currentMessage(3, 'Which serial code was visible on the label?'),
    ];
    let memory = mergeVisualEvidenceIntoMemory(
      null,
      visualEvidence('/images/label.jpg', 'equipment label', ['Serial code ZX-418']),
      'user-1',
    );
    memory = mergeVisualEvidenceIntoMemory(
      memory,
      visualEvidence('/images/chair.jpg', 'wooden chair'),
      'user-2',
    );
    const orchestrator = new ContextOrchestrator(
      compactPolicy({ recentExactTurnLimit: 1, maxMediaEvidenceItems: 1 }),
    );

    const result = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(messages, memory), 'user-3'),
      { diagnosticsEnabled: true },
    );

    const candidates = result.diagnostics?.mediaEvidenceCandidates ?? [];
    expect(candidates).toHaveLength(2);
    const selected = candidates.filter((candidate) => candidate.selected);
    const excluded = candidates.filter((candidate) => !candidate.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.exclusionReason).toBeNull();
    expect(excluded).toHaveLength(1);
    expect(excluded[0]?.exclusionReason).toBe('item-cap');
  });

  it('marks a candidate excluded for budget when the item cap has not been reached', () => {
    const messages = [
      ...completedTurn(1, 'Set the backup policy.', 'The backup schedule is nightly, with a thirty-day retention window.'),
      ...completedTurn(2, 'Choose the theme.', 'The interface will use the light theme for readability across screens.'),
      currentMessage(3, 'What retention window did we choose for backups?'),
    ];
    const orchestrator = new ContextOrchestrator(
      compactPolicy({ recentExactTurnLimit: 0, maximumUnits: 120, maxFactItems: 5 }),
    );

    const result = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-3'),
      { diagnosticsEnabled: true },
    );

    const excludedForBudget = result.diagnostics?.factCandidates.filter(
      (candidate) => candidate.exclusionReason === 'budget',
    );
    expect(excludedForBudget?.length).toBeGreaterThan(0);
  });
});
