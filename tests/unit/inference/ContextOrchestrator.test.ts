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
import type { RetrievedItem } from '../../../src/retrieval/types';
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
    expect(result.context.olderSummary).toBeNull();
    expect(source.messages).toEqual(originalMessages);
  });

  it('selects prior media evidence by deterministic relevance before recency', () => {
    const messages = [
      ...completedTurn(1, 'Inspect the label.', 'The label is readable.', '/images/label.jpg'),
      ...completedTurn(2, 'Inspect the chair.', 'The chair is wooden.', '/images/chair.jpg'),
      currentMessage(3, 'Which object was visible in the label image?'),
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
      ...completedTurn(4, 'Pick a font.', 'Use the system font.'),
      ...completedTurn(5, 'Pick a radius.', 'Use eight pixels.'),
      ...completedTurn(6, 'Pick spacing.', 'Use the standard spacing.'),
      ...completedTurn(7, 'Pick motion.', 'Use reduced motion when requested.'),
      currentMessage(8, 'What retention window did we choose for backups?'),
    ];
    const orchestrator = new ContextOrchestrator(
      compactPolicy({ recentExactTurnLimit: 1, maxFactItems: 1 }),
    );

    const result = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-8'),
      { responseMode: 'Low' },
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

  it('does not pull prior image evidence into a bare-pronoun follow-up', () => {
    // "that"/"it" used to match the visual-reference pattern and dragged stale
    // image evidence into plainly non-visual turns. It must no longer qualify.
    const messages = [
      ...completedTurn(1, 'Inspect the label.', 'The label is readable.', '/images/label.jpg'),
      currentMessage(2, 'Can you clarify that earlier point?'),
    ];
    const memory = mergeVisualEvidenceIntoMemory(
      null,
      visualEvidence('/images/label.jpg', 'equipment label', ['Serial code ZX-418']),
      'user-1',
    );

    const result = new ContextOrchestrator(compactPolicy()).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages, memory), 'user-2'),
    );

    expect(result.context.mediaEvidence).toEqual([]);
  });

  it('routes a newly attached image to original-pixel inference', () => {
    const messages = [
      ...completedTurn(1, 'Inspect the label.', 'The label is readable.', '/images/label.jpg'),
      {
        id: 'user-2',
        role: 'user' as const,
        text: 'And now?',
        attachments: [{ kind: 'image' as const, path: '/images/label.jpg' }],
        status: 'completed' as const,
        errorMessage: null,
        createdAt: 1_700_000_000_010,
      },
    ];
    const memory = mergeVisualEvidenceIntoMemory(
      null,
      visualEvidence('/images/label.jpg', 'equipment label', ['Serial code ZX-418']),
      'user-1',
    );

    const result = new ContextOrchestrator(compactPolicy()).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages, memory), 'user-2'),
    );

    expect(result.context.mediaEvidence).toEqual([]);
    expect(result.imageSelection?.decision).toBe('use-original');
  });

  it('routes a pixel-dependent visual follow-up to original-pixel inference', () => {
    const messages = [
      ...completedTurn(1, 'Inspect the label.', 'The label is readable.', '/images/label.jpg'),
      currentMessage(2, 'What color was shown in the image?'),
    ];
    const memory = mergeVisualEvidenceIntoMemory(
      null,
      visualEvidence('/images/label.jpg', 'equipment label', ['Serial code ZX-418']),
      'user-1',
    );

    const result = new ContextOrchestrator(compactPolicy()).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages, memory), 'user-2'),
    );

    expect(result.context.mediaEvidence).toEqual([]);
    expect(result.imageSelection?.decision).toBe('use-original');
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

  it('selects only the active image evidence for a generic image follow-up', () => {
    const messages = [
      ...completedTurn(1, 'Inspect the label.', 'The label is readable.', '/images/label.jpg'),
      ...completedTurn(2, 'Inspect the chair.', 'The chair is wooden.', '/images/chair.jpg'),
      currentMessage(3, 'Which object is visible in the image?'),
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
    expect(candidates).toHaveLength(1);
    const selected = candidates.filter((candidate) => candidate.selected);
    const excluded = candidates.filter((candidate) => !candidate.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.exclusionReason).toBeNull();
    expect(excluded).toHaveLength(0);
  });

  it('marks a candidate excluded for budget when the item cap has not been reached', () => {
    const messages = [
      ...completedTurn(1, 'Set the backup policy.', 'The backup schedule is nightly, with a thirty-day retention window.'),
      ...completedTurn(2, 'Choose the theme.', 'The interface will use the light theme for readability across screens.'),
      ...completedTurn(3, 'Pick an icon.', 'Use the existing icon.'),
      ...completedTurn(4, 'Pick a font.', 'Use the system font.'),
      ...completedTurn(5, 'Pick a radius.', 'Use eight pixels.'),
      ...completedTurn(6, 'Pick spacing.', 'Use standard spacing.'),
      ...completedTurn(7, 'Pick motion.', 'Honor reduced motion.'),
      currentMessage(8, 'What retention window did we choose for backups?'),
    ];
    const orchestrator = new ContextOrchestrator(
      compactPolicy({ recentExactTurnLimit: 0, maximumUnits: 120, maxFactItems: 5 }),
    );

    const result = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-8'),
      { diagnosticsEnabled: true, responseMode: 'Low' },
    );

    const excludedForBudget = result.diagnostics?.factCandidates.filter(
      (candidate) => candidate.exclusionReason === 'budget',
    );
    expect(excludedForBudget?.length).toBeGreaterThan(0);
  });

  it('assembles persisted sources in fixed priority order with deterministic retrieval', () => {
    const retrieved: RetrievedItem[] = [
      {
        id: 'same-b', sourceConversationId: 'conversation-a', sourceMessageId: 'same-message-b',
        imageAssetId: null, timestamp: 200, contentType: 'chunk', text: 'same chat B', score: 0.9,
      },
      {
        id: 'same-a', sourceConversationId: 'conversation-a', sourceMessageId: 'same-message-a',
        imageAssetId: null, timestamp: 200, contentType: 'chunk', text: 'same chat A', score: 0.9,
      },
    ];
    const search = jest.fn((_input: { conversationIds: readonly string[] }) => retrieved);
    const messages = [
      ...completedTurn(1, 'Recent question', 'Recent answer'),
      ...completedTurn(2, 'Second question', 'Second answer'),
      ...completedTurn(3, 'Third question', 'Third answer'),
      ...completedTurn(4, 'Fourth question', 'Fourth answer'),
      ...completedTurn(5, 'Fifth question', 'Fifth answer'),
      ...completedTurn(6, 'Sixth question', 'Sixth answer'),
      ...completedTurn(7, 'Seventh question', 'Seventh answer'),
      currentMessage(8, 'What did we mention earlier about the current request?'),
    ];
    const orchestrator = new ContextOrchestrator(compactPolicy(), {
      retriever: { search },
      listLexicalCandidates: () => [],
      listDurableFacts: () => [{
        version: 'context-memory-fact-v1', id: 'durable', sourceMessageId: 'durable-source',
        text: 'durable fact', createdAt: 50,
      }],
      getNewestReadySummary: () => 'older range summary',
      retrievalManifest: { embeddingVersion: 'embedding-v1', artifactHash: 'hash-1' },
    });

    const first = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-8'),
      { responseMode: 'Low' },
    );
    const second = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-8'),
      { responseMode: 'Low' },
    );

    expect(first.context).toEqual(second.context);
    expect(first.context.recentTurns).toHaveLength(2);
    expect(first.context.importantFacts.map((fact) => fact.text)).toEqual([
      '[Untrusted source: conversation conversation-a, message same-message-b] same chat B',
      '[Untrusted source: conversation conversation-a, message same-message-a] same chat A',
      'durable fact',
    ]);
    expect(search).toHaveBeenCalledTimes(2);
    for (const call of search.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ conversationIds: ['conversation-a'] }));
    }
    expect(first.context.olderSummary).toBe('older range summary');
  });

  it('caps oversized exact context instead of exceeding the response-mode character budget', () => {
    const messages = [
      ...completedTurn(1, 'Question one', 'A'.repeat(900)),
      ...completedTurn(2, 'Question two', 'B'.repeat(900)),
      ...completedTurn(3, 'Question three', 'C'.repeat(900)),
      ...completedTurn(4, 'Question four', 'D'.repeat(900)),
      ...completedTurn(5, 'Question five', 'E'.repeat(900)),
      ...completedTurn(6, 'Question six', 'F'.repeat(900)),
      currentMessage(7, 'Current request'),
    ];

    const result = new ContextOrchestrator().orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-7'),
      { responseMode: 'Low' },
    );

    expect(result.context.recentTurns.length).toBeLessThan(6);
    expect(result.context.budget.usedUnits).toBeLessThanOrEqual(
      result.context.budget.maximumUnits,
    );
  });

  it('omits active persisted image evidence for an unrelated follow-up', () => {
    const evidence = {
      id: 'evidence-1',
      conversation_id: 'conversation-a',
      source_message_id: 'user-1',
      image_asset_id: 'asset-1',
      evidence_version: 'hidden-evidence-v1',
      subject_object: 'red bicycle',
      visible_features_json: '["red frame"]',
      visible_text_json: '[]',
      visible_condition: 'good condition',
      uncertainty_json: '[]',
      source_revision: 'revision-1',
      created_at: 1_700_000_000_000,
    };
    const orchestrator = new ContextOrchestrator(compactPolicy(), {
      evidenceRepository: {
        getActiveImageEvidence: () => evidence,
        resolveReferencedImageEvidence: () => evidence,
      },
    });
    const messages = [
      ...completedTurn(1, 'What is in this image?', 'A red bicycle.'),
      currentMessage(2, 'Tell me a joke about databases.'),
    ];

    const result = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-2'),
    );

    expect(result.context.mediaEvidence).toEqual([]);
  });

  it.each([
    'What is the cost of tuition?',
    'Count the possible combinations.',
    'What color should my website use?',
    'What is the total population?',
  ])('does not query or select a stale image for unrelated text "%s"', (question) => {
    const getActiveImageEvidence = jest.fn(() => null);
    const messages = [
      ...completedTurn(1, 'What is in this image?', 'A receipt.', '/images/receipt.jpg'),
      currentMessage(2, question),
    ];
    const result = new ContextOrchestrator(compactPolicy(), {
      evidenceRepository: {
        getActiveImageEvidence,
        resolveReferencedImageEvidence: jest.fn(() => null),
      },
    }).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-2'),
      { diagnosticsEnabled: true },
    );

    expect(getActiveImageEvidence).not.toHaveBeenCalled();
    expect(result.imageSelection).toBeNull();
    expect(result.context.mediaEvidence).toEqual([]);
    expect(result.diagnostics?.classification).toEqual(expect.objectContaining({
      isIndependentTextQuestion: true,
      isPixelDependent: false,
      isSameImageFollowUp: false,
    }));
  });

  it('keeps explicitly referenced evidence inside the configured budget', () => {
    const evidence = {
      id: 'evidence-1',
      conversation_id: 'conversation-a',
      source_message_id: 'user-1',
      image_asset_id: 'asset-1',
      evidence_version: 'hidden-evidence-v1',
      subject_object: 'label',
      visible_features_json: JSON.stringify(['A'.repeat(500)]),
      visible_text_json: '[]',
      visible_condition: 'readable',
      uncertainty_json: '[]',
      source_revision: 'revision-1',
      created_at: 1_700_000_000_000,
    };
    const orchestrator = new ContextOrchestrator(
      compactPolicy({ maximumUnits: 120, recentExactTurnLimit: 0 }),
      {
        evidenceRepository: {
          getActiveImageEvidence: () => evidence,
          resolveReferencedImageEvidence: () => evidence,
        },
      },
    );
    const messages = [currentMessage(1, 'Read that label.')];

    const result = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-1'),
      { referencedImage: { sourceMessageId: 'user-1' } },
    );

    expect(result.context.mediaEvidence).toHaveLength(1);
    expect(result.context.mediaEvidence[0]?.sourcePath).toBe('asset-1');
    expect(result.context.budget.usedUnits).toBeLessThanOrEqual(
      result.context.budget.maximumUnits,
    );
  });

  it('evicts recent turns before dropping large protected image evidence', () => {
    const evidence = {
      id: 'evidence-large',
      conversation_id: 'conversation-a',
      source_message_id: 'user-2',
      image_asset_id: 'asset-large',
      evidence_version: 'hidden-evidence-v1',
      subject_object: 'large label',
      visible_features_json: JSON.stringify(['feature '.repeat(200)]),
      visible_text_json: JSON.stringify(['SERIAL ZX-418 '.repeat(100)]),
      visible_condition: 'readable',
      uncertainty_json: '[]',
      source_revision: 'revision-large',
      created_at: 3,
    };
    const messages = [
      ...completedTurn(1, 'Old question '.repeat(10), 'Old answer '.repeat(10)),
      ...completedTurn(2, 'Inspect this image.', 'A label.', '/images/label.jpg'),
      currentMessage(3, 'What kind of document is in the image?'),
    ];
    messages[2].attachments[0].imageAssetId = 'asset-large';
    const result = new ContextOrchestrator(
      compactPolicy({ maximumUnits: 140, recentExactTurnLimit: 4 }),
      {
        evidenceRepository: {
          getActiveImageEvidence: () => evidence,
          resolveReferencedImageEvidence: () => evidence,
        },
      },
    ).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-3'),
      { diagnosticsEnabled: true },
    );

    expect(result.context.mediaEvidence).toHaveLength(1);
    expect(result.context.recentTurns).toHaveLength(0);
    expect(result.context.budget.usedUnits).toBeLessThanOrEqual(
      result.context.budget.maximumUnits,
    );
  });

  it('preserves large explicitly referenced older-image evidence within the final budget', () => {
    const evidence = {
      id: 'evidence-older-large',
      conversation_id: 'conversation-a',
      source_message_id: 'user-1',
      image_asset_id: 'asset-older',
      evidence_version: 'hidden-evidence-v1',
      subject_object: 'receipt '.repeat(80),
      visible_features_json: '[]',
      visible_text_json: JSON.stringify(['TOTAL $12.99 '.repeat(100)]),
      visible_condition: 'readable',
      uncertainty_json: '[]',
      source_revision: 'revision-older',
      created_at: 1,
    };
    const messages = [
      ...completedTurn(1, 'First image.', 'A receipt.', '/images/receipt.jpg'),
      ...completedTurn(2, 'Second image.', 'A chair.', '/images/chair.jpg'),
      currentMessage(3, 'What object is in the first image?'),
    ];
    messages[0].attachments[0].imageAssetId = 'asset-older';
    messages[2].attachments[0].imageAssetId = 'asset-active';
    const result = new ContextOrchestrator(
      compactPolicy({ maximumUnits: 120, recentExactTurnLimit: 4 }),
      {
        evidenceRepository: {
          getActiveImageEvidence: () => null,
          resolveReferencedImageEvidence: () => evidence,
        },
      },
    ).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-3'),
      { diagnosticsEnabled: true },
    );

    expect(result.context.mediaEvidence[0]?.sourcePath).toBe('asset-older');
    expect(result.context.budget.usedUnits).toBeLessThanOrEqual(
      result.context.budget.maximumUnits,
    );
  });

  it('defaults an ambiguous reference among three images to the active image', () => {
    const messages = [
      ...completedTurn(1, 'Describe this.', 'A receipt.', '/images/one.jpg'),
      ...completedTurn(2, 'Describe this.', 'A chair.', '/images/two.jpg'),
      ...completedTurn(3, 'Describe this.', 'A label.', '/images/three.jpg'),
      currentMessage(4, 'What is visible in the image?'),
    ];
    messages[0].attachments[0].imageAssetId = 'asset-1';
    messages[2].attachments[0].imageAssetId = 'asset-2';
    messages[4].attachments[0].imageAssetId = 'asset-3';
    const activeEvidence = {
      id: 'evidence-3',
      conversation_id: 'conversation-a',
      source_message_id: 'user-3',
      image_asset_id: 'asset-3',
      evidence_version: 'hidden-evidence-v1',
      subject_object: 'label',
      visible_features_json: '["white paper"]',
      visible_text_json: '["ACTIVE"]',
      visible_condition: 'readable',
      uncertainty_json: '[]',
      source_revision: 'revision-3',
      created_at: 3,
    };
    const resolveReferencedImageEvidence = jest.fn(() => null);
    const orchestrator = new ContextOrchestrator(compactPolicy(), {
      evidenceRepository: {
        getActiveImageEvidence: () => activeEvidence,
        resolveReferencedImageEvidence,
      },
    });

    const result = orchestrator.orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-4'),
      { diagnosticsEnabled: true },
    );

    expect(result.diagnostics?.classification).toEqual(expect.objectContaining({
      imageReferenceAmbiguous: true,
      isSameImageFollowUp: true,
      isOlderImageReference: false,
      referencedImageId: null,
    }));
    expect(result.diagnostics?.imageReferenceAmbiguous).toBe(true);
    expect(result).toEqual(expect.objectContaining({
      imageSelection: expect.objectContaining({
        decision: 'use-evidence',
        imageAssetId: 'asset-3',
      }),
    }));
    expect(result.context.mediaEvidence[0]?.sourcePath).toBe('asset-3');
    expect(resolveReferencedImageEvidence).not.toHaveBeenCalled();
  });

  it('reuses active evidence for a non-pixel same-image follow-up', () => {
    const messages = [
      ...completedTurn(1, 'Describe this.', 'A receipt.', '/images/receipt.jpg'),
      currentMessage(2, 'What kind of document is that image?'),
    ];
    messages[0].attachments[0].imageAssetId = 'asset-receipt';
    const evidence = {
      id: 'evidence-receipt',
      conversation_id: 'conversation-a',
      source_message_id: 'user-1',
      image_asset_id: 'asset-receipt',
      evidence_version: 'hidden-evidence-v1',
      subject_object: 'receipt',
      visible_features_json: '["paper document"]',
      visible_text_json: '[]',
      visible_condition: 'readable',
      uncertainty_json: '[]',
      source_revision: 'revision-1',
      created_at: 1,
    };
    const resolveReferencedImageEvidence = jest.fn(() => null);
    const result = new ContextOrchestrator(compactPolicy(), {
      evidenceRepository: {
        getActiveImageEvidence: () => evidence,
        resolveReferencedImageEvidence,
      },
    }).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-2'),
      { diagnosticsEnabled: true },
    );

    expect(result.imageSelection).toEqual(expect.objectContaining({
      decision: 'use-evidence',
      imageAssetId: 'asset-receipt',
    }));
    expect(result.context.mediaEvidence[0]?.summary).toBe('receipt');
    expect(resolveReferencedImageEvidence).not.toHaveBeenCalled();
  });

  it('uses exact older-image evidence when its original is missing and pixels are not needed', () => {
    const messages = [
      ...completedTurn(1, 'Describe this.', 'A receipt.', '/images/receipt.jpg'),
      ...completedTurn(2, 'Describe this.', 'A chair.', '/images/chair.jpg'),
      currentMessage(3, 'What object was in the first image?'),
    ];
    messages[0].attachments[0].imageAssetId = 'asset-receipt';
    messages[0].attachments[0].available = false;
    messages[2].attachments[0].imageAssetId = 'asset-chair';
    const evidence = {
      id: 'evidence-receipt',
      conversation_id: 'conversation-a',
      source_message_id: 'user-1',
      image_asset_id: 'asset-receipt',
      evidence_version: 'hidden-evidence-v1',
      subject_object: 'receipt',
      visible_features_json: '["paper document"]',
      visible_text_json: '["TOTAL $12"]',
      visible_condition: 'readable',
      uncertainty_json: '[]',
      source_revision: 'revision-1',
      created_at: 1,
    };
    const resolveReferencedImageEvidence = jest.fn(() => evidence);
    const result = new ContextOrchestrator(compactPolicy(), {
      evidenceRepository: {
        getActiveImageEvidence: () => null,
        resolveReferencedImageEvidence,
      },
    }).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-3'),
      { diagnosticsEnabled: true },
    );

    expect(resolveReferencedImageEvidence).toHaveBeenCalledWith({
      conversationId: 'conversation-a',
      imageAssetId: 'asset-receipt',
    });
    expect(result.imageSelection?.decision).toBe('use-evidence');
    expect(result.context.mediaEvidence[0]?.sourcePath).toBe('asset-receipt');
  });

  it('reports original-unavailable without stale evidence for a pixel-dependent older image', () => {
    const messages = [
      ...completedTurn(1, 'Describe this.', 'A receipt.', '/images/receipt.jpg'),
      ...completedTurn(2, 'Describe this.', 'A chair.', '/images/chair.jpg'),
      currentMessage(3, 'Read the exact total from the first image.'),
    ];
    messages[0].attachments[0].imageAssetId = 'asset-receipt';
    messages[0].attachments[0].available = false;
    messages[2].attachments[0].imageAssetId = 'asset-chair';
    const evidence = {
      id: 'evidence-receipt',
      conversation_id: 'conversation-a',
      source_message_id: 'user-1',
      image_asset_id: 'asset-receipt',
      evidence_version: 'hidden-evidence-v1',
      subject_object: 'receipt',
      visible_features_json: '[]',
      visible_text_json: '["TOTAL $12"]',
      visible_condition: 'readable',
      uncertainty_json: '[]',
      source_revision: 'revision-1',
      created_at: 1,
    };
    const result = new ContextOrchestrator(compactPolicy(), {
      evidenceRepository: {
        getActiveImageEvidence: () => null,
        resolveReferencedImageEvidence: () => evidence,
      },
    }).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-3'),
      { diagnosticsEnabled: true },
    );

    expect(result.imageSelection?.decision).toBe('original-unavailable');
    expect(result.context.mediaEvidence).toEqual([]);
    expect(result.diagnostics?.imageDecision).toBe('original-unavailable');
  });

  it('hard-skips every prior context source for an independent question', () => {
    const search = jest.fn((): RetrievedItem[] => []);
    const getActiveImageEvidence = jest.fn(() => null);
    const listDurableFacts = jest.fn(() => []);
    const getNewestReadySummary = jest.fn(() => null);
    const messages = [
      ...completedTurn(1, 'Unrelated history.', 'Unrelated answer.'),
      currentMessage(2, 'Define entropy'),
    ];
    const result = new ContextOrchestrator(compactPolicy(), {
      retriever: { search },
      listLexicalCandidates: () => [],
      evidenceRepository: {
        getActiveImageEvidence,
        resolveReferencedImageEvidence: jest.fn(() => null),
      },
      listDurableFacts,
      getNewestReadySummary,
    }).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-2'),
      { diagnosticsEnabled: true },
    );

    expect(search).not.toHaveBeenCalled();
    expect(getActiveImageEvidence).not.toHaveBeenCalled();
    expect(listDurableFacts).not.toHaveBeenCalled();
    expect(getNewestReadySummary).not.toHaveBeenCalled();
    expect(result.diagnostics).toEqual(expect.objectContaining({
      retrievalMode: 'none',
      retrievalModeReason: 'independent-question-hard-skip',
      retrievalQueried: false,
      retrievalCandidatesReturned: 0,
      retrievalItemsSelected: 0,
      actualSources: expect.objectContaining({
        recentTurns: { queried: false, selected: 0 },
        imageEvidence: { queried: false, selected: 0 },
        retrieval: { queried: false, selected: 0 },
        durableFacts: { queried: false, selected: 0 },
        summary: { queried: false, selected: 0 },
      }),
      proposedRouting: {
        wouldSkipRetrieval: true,
        reason: 'phase-3-independent-question',
      },
    }));
    expect(result.diagnostics?.recentTurnsConsidered).toBe(0);
    expect(result.context.recentTurns).toHaveLength(0);
    expect(result.context.mediaEvidence).toHaveLength(0);
    expect(result.context.importantFacts).toHaveLength(0);
    expect(result.context.olderSummary).toBeNull();
  });

  it('scopes ordinary follow-ups to recent turns without retrieval, facts, or summary', () => {
    const search = jest.fn((): RetrievedItem[] => []);
    const listDurableFacts = jest.fn(() => []);
    const getNewestReadySummary = jest.fn(() => 'unrelated summary');
    const messages = [
      ...completedTurn(1, 'Explain gravity.', 'Gravity attracts mass.'),
      currentMessage(2, 'Why is that?'),
    ];
    const result = new ContextOrchestrator(compactPolicy(), {
      retriever: { search },
      listLexicalCandidates: () => [],
      listDurableFacts,
      getNewestReadySummary,
    }).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-2'),
      { diagnosticsEnabled: true },
    );

    expect(result.context.recentTurns).toHaveLength(1);
    expect(result.context.importantFacts).toEqual([]);
    expect(result.context.olderSummary).toBeNull();
    expect(search).not.toHaveBeenCalled();
    expect(listDurableFacts).not.toHaveBeenCalled();
    expect(getNewestReadySummary).not.toHaveBeenCalled();
  });

  it('evicts retrieved items and facts before an older-range summary under pressure', () => {
    const retrieved: RetrievedItem[] = [{
      id: 'retrieved',
      sourceConversationId: 'conversation-a',
      sourceMessageId: 'source-retrieved',
      imageAssetId: null,
      timestamp: 1,
      contentType: 'chunk',
      text: 'retrieved '.repeat(20),
      score: 1,
    }];
    const messages = Array.from({ length: 7 }, (_, index) =>
      completedTurn(index + 1, `Question ${index}`, `Answer ${index}`),
    ).flat();
    messages.push(currentMessage(8, 'What did I mention in another conversation?'));
    const result = new ContextOrchestrator(
      compactPolicy({ maximumUnits: 100, recentExactTurnLimit: 0 }),
      {
        retriever: { search: () => retrieved },
        listLexicalCandidates: () => [],
        listDurableFacts: () => [{
          version: 'context-memory-fact-v1',
          id: 'fact',
          sourceMessageId: 'source-fact',
          text: 'durable '.repeat(20),
          createdAt: 1,
        }],
        getNewestReadySummary: () => 'summary',
      },
    ).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-8'),
      { responseMode: 'Low' },
    );

    expect(result.context.olderSummary).toBe('summary');
    expect(result.context.importantFacts).toEqual([]);
  });

  it('records cross-chat activity only when expanded scope is actually queried', () => {
    const search = jest.fn((): RetrievedItem[] => []);
    const messages = Array.from({ length: 7 }, (_, index) =>
      completedTurn(index + 1, `Question ${index}`, `Answer ${index}`),
    ).flat();
    messages.push(currentMessage(8, 'What did I mention in another conversation?'));
    const result = new ContextOrchestrator(compactPolicy(), {
      retriever: { search },
      listLexicalCandidates: () => [],
    }).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-8'),
      {
        responseMode: 'Low',
        diagnosticsEnabled: true,
        crossChat: {
          enabled: true,
          currentConversationExcluded: false,
          eligibleConversationIds: ['conversation-a', 'conversation-b'],
        },
      },
    );

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      conversationIds: ['conversation-a', 'conversation-b'],
    }));
    expect(result.diagnostics?.crossChatActive).toBe(true);
    expect(result.diagnostics?.crossChatQueried).toBe(true);
    expect(result.diagnostics?.crossChatItemsSelected).toBe(0);
  });

  it.each([
    ['new chat', []],
    ['short chat', completedTurn(1, 'Hello.', 'Hi.')],
  ])('queries eligible cross-chat scope from a %s', (_label, prior) => {
    const crossChatItem: RetrievedItem = {
      id: 'other-item',
      sourceConversationId: 'conversation-b',
      sourceMessageId: 'other-message',
      imageAssetId: null,
      timestamp: 10,
      contentType: 'chunk',
      text: 'The apartment address was 12 Main Street.',
      score: 1,
    };
    const search = jest.fn(() => [crossChatItem]);
    const messages = [
      ...prior,
      currentMessage(8, 'What address did I mention in my apartment chat?'),
    ];
    const result = new ContextOrchestrator(compactPolicy(), {
      retriever: { search },
      listLexicalCandidates: () => [],
    }).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-8'),
      {
        diagnosticsEnabled: true,
        crossChat: {
          enabled: true,
          currentConversationExcluded: false,
          eligibleConversationIds: ['conversation-b'],
        },
      },
    );

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      conversationIds: ['conversation-a', 'conversation-b'],
    }));
    expect(result.diagnostics).toEqual(expect.objectContaining({
      crossChatActive: true,
      crossChatQueried: true,
      crossChatItemsSelected: 1,
    }));
    expect(result.context.importantFacts[0]?.id).toContain('conversation-b');
  });

  it('does not query cross-chat scope for an ordinary question when globally enabled', () => {
    const search = jest.fn((): RetrievedItem[] => []);
    const result = new ContextOrchestrator(compactPolicy(), {
      retriever: { search },
      listLexicalCandidates: () => [],
    }).orchestrate(
      createCanonicalConversationSnapshot(
        conversation([currentMessage(1, 'What is the capital of France?')]),
        'user-1',
      ),
      {
        diagnosticsEnabled: true,
        crossChat: {
          enabled: true,
          currentConversationExcluded: false,
          eligibleConversationIds: ['conversation-b'],
        },
      },
    );

    expect(search).not.toHaveBeenCalled();
    expect(result.diagnostics).toEqual(expect.objectContaining({
      crossChatActive: false,
      crossChatQueried: false,
      crossChatItemsSelected: 0,
    }));
  });

  it('stops cross-chat queries immediately when the global setting is disabled', () => {
    const search = jest.fn((): RetrievedItem[] => []);
    const orchestrator = new ContextOrchestrator(compactPolicy(), {
      retriever: { search },
      listLexicalCandidates: () => [],
    });
    const snapshot = createCanonicalConversationSnapshot(
      conversation([currentMessage(1, 'What did I say in another conversation?')]),
      'user-1',
    );

    orchestrator.orchestrate(snapshot, {
      crossChat: {
        enabled: true,
        currentConversationExcluded: false,
        eligibleConversationIds: ['conversation-b'],
      },
    });
    orchestrator.orchestrate(snapshot, {
      crossChat: {
        enabled: false,
        currentConversationExcluded: false,
        eligibleConversationIds: ['conversation-b'],
      },
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenNthCalledWith(1, expect.objectContaining({
      conversationIds: ['conversation-a', 'conversation-b'],
    }));
  });

  it.each([
    ['global setting off', false, false],
    ['current conversation excluded', true, true],
  ])('does not expand cross-chat scope when %s', (_label, enabled, excluded) => {
    const search = jest.fn((): RetrievedItem[] => []);
    const result = new ContextOrchestrator(compactPolicy(), {
      retriever: { search },
      listLexicalCandidates: () => [],
    }).orchestrate(
      createCanonicalConversationSnapshot(
        conversation([currentMessage(1, 'What did I say in another conversation?')]),
        'user-1',
      ),
      {
        diagnosticsEnabled: true,
        crossChat: {
          enabled,
          currentConversationExcluded: excluded,
          eligibleConversationIds: ['conversation-b'],
        },
      },
    );

    expect(search).not.toHaveBeenCalled();
    expect(result.diagnostics?.crossChatQueried).toBe(false);
  });

  it('resolves a uniquely matching evidence-backed image description', () => {
    const messages = [
      ...completedTurn(1, 'Inspect this.', 'A receipt.', '/images/receipt.jpg'),
      ...completedTurn(2, 'Inspect this.', 'A chair.', '/images/chair.jpg'),
      currentMessage(3, 'What was written on the receipt?'),
    ];
    messages[0].attachments[0].imageAssetId = 'asset-receipt';
    messages[2].attachments[0].imageAssetId = 'asset-chair';
    const receiptEvidence = {
      id: 'evidence-receipt',
      conversation_id: 'conversation-a',
      source_message_id: 'user-1',
      image_asset_id: 'asset-receipt',
      evidence_version: 'hidden-evidence-v1',
      subject_object: 'shopping receipt',
      visible_features_json: '["paper receipt"]',
      visible_text_json: '["TOTAL $12"]',
      visible_condition: 'readable',
      uncertainty_json: '[]',
      source_revision: 'revision-1',
      created_at: 1,
    };
    const chairEvidence = {
      ...receiptEvidence,
      id: 'evidence-chair',
      source_message_id: 'user-2',
      image_asset_id: 'asset-chair',
      subject_object: 'wooden chair',
      visible_features_json: '["brown seat"]',
      visible_text_json: '[]',
      source_revision: 'revision-2',
      created_at: 2,
    };
    const resolveReferencedImageEvidence = jest.fn(() => receiptEvidence);
    const result = new ContextOrchestrator(compactPolicy(), {
      evidenceRepository: {
        getActiveImageEvidence: () => chairEvidence,
        resolveReferencedImageEvidence,
        listImageReferenceCandidates: () => [
          {
            imageAssetId: 'asset-receipt',
            sourceMessageId: 'user-1',
            localPath: '/images/receipt.jpg',
            available: true,
            createdAt: 1,
            searchText: 'shopping receipt TOTAL $12',
          },
          {
            imageAssetId: 'asset-chair',
            sourceMessageId: 'user-2',
            localPath: '/images/chair.jpg',
            available: true,
            createdAt: 2,
            searchText: 'wooden chair brown seat',
          },
        ],
      },
    }).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-3'),
      { diagnosticsEnabled: true },
    );

    expect(result.diagnostics?.classification).toEqual(expect.objectContaining({
      isOlderImageReference: true,
      isSameImageFollowUp: false,
      referencedImageId: 'asset-receipt',
      imageReferenceAmbiguous: false,
    }));
    expect(result.diagnostics?.imageReferenceResolution).toBe('unique-description');
    expect(resolveReferencedImageEvidence).toHaveBeenCalledWith({
      conversationId: 'conversation-a',
      imageAssetId: 'asset-receipt',
    });
    expect(result.imageSelection).toEqual(expect.objectContaining({
      imageAssetId: 'asset-receipt',
      decision: 'use-original',
      originalPath: '/images/receipt.jpg',
    }));
  });

  it('records a tied two-image description as an ambiguous active-image fallback', () => {
    const messages = [
      ...completedTurn(1, 'Inspect this.', 'A wooden chair.', '/images/chair-a.jpg'),
      ...completedTurn(2, 'Inspect this.', 'A metal chair.', '/images/chair-b.jpg'),
      currentMessage(3, 'Show me the chair image again'),
    ];
    messages[0].attachments[0].imageAssetId = 'asset-chair-a';
    messages[2].attachments[0].imageAssetId = 'asset-chair-b';
    const activeEvidence = {
      id: 'evidence-chair-b',
      conversation_id: 'conversation-a',
      source_message_id: 'user-2',
      image_asset_id: 'asset-chair-b',
      evidence_version: 'hidden-evidence-v1',
      subject_object: 'metal chair',
      visible_features_json: '[]',
      visible_text_json: '[]',
      visible_condition: 'visible',
      uncertainty_json: '[]',
      source_revision: 'revision-2',
      created_at: 2,
    };
    const resolveReferencedImageEvidence = jest.fn(() => null);
    const result = new ContextOrchestrator(compactPolicy(), {
      evidenceRepository: {
        getActiveImageEvidence: () => activeEvidence,
        resolveReferencedImageEvidence,
        listImageReferenceCandidates: () => [
          {
            imageAssetId: 'asset-chair-a',
            sourceMessageId: 'user-1',
            localPath: '/images/chair-a.jpg',
            available: true,
            createdAt: 1,
            searchText: 'wooden chair',
          },
          {
            imageAssetId: 'asset-chair-b',
            sourceMessageId: 'user-2',
            localPath: '/images/chair-b.jpg',
            available: true,
            createdAt: 2,
            searchText: 'metal chair',
          },
        ],
      },
    }).orchestrate(
      createCanonicalConversationSnapshot(conversation(messages), 'user-3'),
      { diagnosticsEnabled: true },
    );

    expect(result.diagnostics?.classification.imageReferenceAmbiguous).toBe(true);
    expect(result.diagnostics?.imageReferenceResolution).toBe('ambiguous-active-fallback');
    expect(result.imageSelection?.imageAssetId).toBe('asset-chair-b');
    expect(resolveReferencedImageEvidence).not.toHaveBeenCalled();
  });
});
