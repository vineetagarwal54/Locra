import type {
  CanonicalContextTurn,
  CanonicalConversationContext,
  CanonicalConversationSnapshot,
  ContextMediaEvidence,
  ContextMemoryFact,
  ContextRollingSummary,
  ContextSummaryEntry,
  Conversation,
  ConversationContextMemory,
  ConversationMessage,
} from '../types/models';

import type { HiddenVisualEvidence } from './OutputPipelineTypes';

const DEFAULT_MAXIMUM_UNITS = 14_400;
const DEFAULT_RECENT_EXACT_TURN_LIMIT = 8;
const DEFAULT_MAX_MEDIA_EVIDENCE_ITEMS = 3;
const DEFAULT_MAX_FACT_ITEMS = 6;
const DEFAULT_MAX_SUMMARY_ENTRIES = 6;
const TURN_ROLE_OVERHEAD_UNITS = 32;

interface CompletedTurn {
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly question: string;
  readonly answer: string;
  readonly createdAt: number;
}

interface RankedItem<T> {
  readonly item: T;
  readonly relevance: number;
  readonly createdAt: number;
  readonly stableId: string;
}

export interface ContextBudgetPolicy {
  readonly policyId: string;
  readonly maximumUnits: number;
  readonly recentExactTurnLimit: number;
  readonly maxMediaEvidenceItems: number;
  readonly maxFactItems: number;
  readonly maxSummaryEntries: number;
  measure(content: string): number;
}

export interface CharacterContextBudgetPolicyOptions {
  maximumUnits?: number;
  recentExactTurnLimit?: number;
  maxMediaEvidenceItems?: number;
  maxFactItems?: number;
  maxSummaryEntries?: number;
}

export class CharacterContextBudgetPolicy implements ContextBudgetPolicy {
  readonly policyId = 'character-budget-v1';
  readonly maximumUnits: number;
  readonly recentExactTurnLimit: number;
  readonly maxMediaEvidenceItems: number;
  readonly maxFactItems: number;
  readonly maxSummaryEntries: number;

  constructor(options: CharacterContextBudgetPolicyOptions = {}) {
    this.maximumUnits = positiveInteger(options.maximumUnits, DEFAULT_MAXIMUM_UNITS);
    this.recentExactTurnLimit = nonNegativeInteger(
      options.recentExactTurnLimit,
      DEFAULT_RECENT_EXACT_TURN_LIMIT,
    );
    this.maxMediaEvidenceItems = nonNegativeInteger(
      options.maxMediaEvidenceItems,
      DEFAULT_MAX_MEDIA_EVIDENCE_ITEMS,
    );
    this.maxFactItems = nonNegativeInteger(options.maxFactItems, DEFAULT_MAX_FACT_ITEMS);
    this.maxSummaryEntries = nonNegativeInteger(
      options.maxSummaryEntries,
      DEFAULT_MAX_SUMMARY_ENTRIES,
    );
  }

  measure(content: string): number {
    return content.length;
  }
}

export interface ContextOrchestrationResult {
  readonly context: CanonicalConversationContext;
  readonly memory: ConversationContextMemory;
}

export class ContextOrchestrator {
  constructor(
    private readonly budgetPolicy: ContextBudgetPolicy = new CharacterContextBudgetPolicy(),
  ) {}

  orchestrate(snapshot: CanonicalConversationSnapshot): ContextOrchestrationResult {
    const completedTurns = completedTurnsFromMessages(snapshot.priorMessages);
    const selection = selectRecentTurns(
      completedTurns,
      snapshot.currentMessage.text,
      this.budgetPolicy,
    );
    const olderTurns = completedTurns.slice(0, completedTurns.length - selection.turns.length);
    const memory = rebuildDerivedMemory(snapshot, olderTurns);
    let usedUnits = selection.usedUnits;

    const mediaEvidence = selectWithinBudget(
      rankMediaEvidence(memory.mediaEvidence, snapshot.currentMessage.text),
      this.budgetPolicy.maxMediaEvidenceItems,
      usedUnits,
      this.budgetPolicy,
      formatMediaEvidence,
    );
    usedUnits = mediaEvidence.usedUnits;

    const importantFacts = selectWithinBudget(
      rankFacts(memory.importantFacts, snapshot.currentMessage.text),
      this.budgetPolicy.maxFactItems,
      usedUnits,
      this.budgetPolicy,
      formatMemoryFact,
    );
    usedUnits = importantFacts.usedUnits;

    const summaryEntries = selectWithinBudget(
      rankSummaryEntries(memory.rollingSummary?.entries ?? [], snapshot.currentMessage.text),
      this.budgetPolicy.maxSummaryEntries,
      usedUnits,
      this.budgetPolicy,
      formatSummaryEntry,
    );
    usedUnits = summaryEntries.usedUnits;

    return {
      context: {
        version: 'canonical-conversation-v2',
        recentTurns: selection.turns.map(cloneContextTurn),
        mediaEvidence: mediaEvidence.items.map(cloneMediaEvidence),
        importantFacts: importantFacts.items.map(cloneMemoryFact),
        olderSummary: buildSelectedSummary(summaryEntries.items),
        budget: {
          policyId: this.budgetPolicy.policyId,
          maximumUnits: this.budgetPolicy.maximumUnits,
          usedUnits,
        },
      },
      memory: cloneContextMemory(memory),
    };
  }
}

export function createCanonicalConversationSnapshot(
  conversation: Conversation,
  currentUserMessageId: string,
): CanonicalConversationSnapshot {
  const currentIndex = conversation.messages.findIndex(
    (message) => message.id === currentUserMessageId,
  );
  const currentMessage = conversation.messages[currentIndex];
  if (currentIndex < 0 || currentMessage?.role !== 'user') {
    throw new Error(`User conversation message not found: ${currentUserMessageId}`);
  }

  return {
    version: 'canonical-conversation-snapshot-v1',
    conversationId: conversation.id,
    priorMessages: conversation.messages.slice(0, currentIndex).map(cloneConversationMessage),
    currentMessage: cloneConversationMessage(currentMessage),
    contextMemory: cloneContextMemoryOrNull(conversation.contextMemory),
  };
}

export function mergeVisualEvidenceIntoMemory(
  memory: ConversationContextMemory | null | undefined,
  evidence: HiddenVisualEvidence,
  sourceMessageId: string,
): ConversationContextMemory {
  const base = cloneContextMemoryOrNull(memory) ?? emptyContextMemory();
  const mapped: ContextMediaEvidence = {
    version: 'context-media-evidence-v1',
    id: `${sourceMessageId}:image`,
    sourceMessageId,
    modality: 'image',
    sourcePath: evidence.imagePath,
    summary: evidence.subjectObject,
    facts: [...evidence.visibleFeatures, evidence.visibleCondition].filter(isNonEmptyString),
    extractedText: evidence.visibleText.filter(isNonEmptyString),
    uncertainty: evidence.uncertainty.filter(isNonEmptyString),
    createdAt: parseEvidenceTimestamp(evidence.createdAt),
  };

  return mergeMediaEvidenceIntoMemory(base, mapped);
}

export function mergeMediaEvidenceIntoMemory(
  memory: ConversationContextMemory | null | undefined,
  evidence: ContextMediaEvidence,
): ConversationContextMemory {
  const base = cloneContextMemoryOrNull(memory) ?? emptyContextMemory();
  return {
    ...base,
    mediaEvidence: [
      ...base.mediaEvidence.filter((item) => item.id !== evidence.id),
      cloneMediaEvidence(evidence),
    ],
  };
}

export function formatMediaEvidence(evidence: ContextMediaEvidence): string {
  const lines = [`${evidence.modality}: ${evidence.summary}`];
  if (evidence.facts.length > 0) {
    lines.push(`Details: ${evidence.facts.join('; ')}`);
  }
  if (evidence.extractedText.length > 0) {
    lines.push(`Extracted text: ${evidence.extractedText.join('; ')}`);
  }
  if (evidence.uncertainty.length > 0) {
    lines.push(`Uncertainty: ${evidence.uncertainty.join('; ')}`);
  }
  return lines.join('\n');
}

export function formatMemoryFact(fact: ContextMemoryFact): string {
  return fact.text;
}

export function formatSummaryEntry(entry: ContextSummaryEntry): string {
  return entry.text;
}

function selectRecentTurns(
  turns: ReadonlyArray<CompletedTurn>,
  currentRequest: string,
  policy: ContextBudgetPolicy,
): { turns: CanonicalContextTurn[]; usedUnits: number } {
  const selected: CanonicalContextTurn[] = [];
  let usedUnits = policy.measure(currentRequest);
  const candidates = turns.slice(-policy.recentExactTurnLimit);

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const turn = candidates[index];
    const cost = policy.measure(turn.question) + policy.measure(turn.answer) + TURN_ROLE_OVERHEAD_UNITS;
    if (usedUnits + cost > policy.maximumUnits) {
      break;
    }
    selected.unshift({ question: turn.question, answer: turn.answer });
    usedUnits += cost;
  }

  return { turns: selected, usedUnits };
}

function rebuildDerivedMemory(
  snapshot: CanonicalConversationSnapshot,
  olderTurns: ReadonlyArray<CompletedTurn>,
): ConversationContextMemory {
  const validSourceIds = new Set(
    snapshot.priorMessages
      .filter((message) => message.role === 'user')
      .map((message) => message.id),
  );
  const mediaEvidence = (snapshot.contextMemory?.mediaEvidence ?? [])
    .filter((item) => validSourceIds.has(item.sourceMessageId))
    .map(cloneMediaEvidence);
  const entries = olderTurns.map(turnToSummaryEntry);
  const rollingSummary: ContextRollingSummary | null = entries.length === 0
    ? null
    : {
        version: 'rolling-summary-v1',
        coveredThroughMessageId: olderTurns[olderTurns.length - 1].assistantMessageId,
        sourceMessageIds: olderTurns.flatMap((turn) => [
          turn.userMessageId,
          turn.assistantMessageId,
        ]),
        entries,
      };

  return {
    version: 'conversation-context-memory-v1',
    sourceMessageCount: snapshot.priorMessages.length,
    rollingSummary,
    importantFacts: olderTurns.flatMap(turnToFacts),
    mediaEvidence,
  };
}

function completedTurnsFromMessages(
  messages: ReadonlyArray<ConversationMessage>,
): CompletedTurn[] {
  const turns: CompletedTurn[] = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (
      user?.role === 'user' &&
      assistant?.role === 'assistant' &&
      assistant.status === 'completed'
    ) {
      turns.push({
        userMessageId: user.id,
        assistantMessageId: assistant.id,
        question: user.text.trim(),
        answer: assistant.text.trim(),
        createdAt: assistant.createdAt,
      });
      index += 1;
    }
  }
  return turns;
}

function turnToSummaryEntry(turn: CompletedTurn): ContextSummaryEntry {
  return {
    version: 'context-summary-entry-v1',
    sourceUserMessageId: turn.userMessageId,
    sourceAssistantMessageId: turn.assistantMessageId,
    text: `User: ${compactText(turn.question, 180)}\nLocra: ${compactText(turn.answer, 280)}`,
    createdAt: turn.createdAt,
  };
}

function turnToFacts(turn: CompletedTurn): ContextMemoryFact[] {
  return splitFactCandidates(turn.answer).slice(0, 3).map((text, index) => ({
    version: 'context-memory-fact-v1',
    id: `${turn.assistantMessageId}:fact:${index}`,
    sourceMessageId: turn.assistantMessageId,
    text,
    createdAt: turn.createdAt,
  }));
}

function splitFactCandidates(text: string): string[] {
  return text
    .split(/[\r\n.!?]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12);
}

function rankMediaEvidence(
  evidence: ReadonlyArray<ContextMediaEvidence>,
  query: string,
): RankedItem<ContextMediaEvidence>[] {
  return rankItems(evidence, query, formatMediaEvidence, (item) => item.createdAt, (item) => item.id);
}

function rankFacts(
  facts: ReadonlyArray<ContextMemoryFact>,
  query: string,
): RankedItem<ContextMemoryFact>[] {
  return rankItems(facts, query, formatMemoryFact, (item) => item.createdAt, (item) => item.id);
}

function rankSummaryEntries(
  entries: ReadonlyArray<ContextSummaryEntry>,
  query: string,
): RankedItem<ContextSummaryEntry>[] {
  return rankItems(
    entries,
    query,
    formatSummaryEntry,
    (item) => item.createdAt,
    (item) => item.sourceAssistantMessageId,
  );
}

function rankItems<T>(
  items: ReadonlyArray<T>,
  query: string,
  content: (item: T) => string,
  createdAt: (item: T) => number,
  stableId: (item: T) => string,
): RankedItem<T>[] {
  const queryTokens = tokenSet(query);
  return items
    .map((item) => ({
      item,
      relevance: lexicalOverlap(queryTokens, tokenSet(content(item))),
      createdAt: createdAt(item),
      stableId: stableId(item),
    }))
    .sort(compareRankedItems);
}

function compareRankedItems<T>(left: RankedItem<T>, right: RankedItem<T>): number {
  if (left.relevance !== right.relevance) {
    return right.relevance - left.relevance;
  }
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  return left.stableId.localeCompare(right.stableId);
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}

function lexicalOverlap(queryTokens: Set<string>, candidateTokens: Set<string>): number {
  let overlap = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function selectWithinBudget<T>(
  ranked: ReadonlyArray<RankedItem<T>>,
  maximumItems: number,
  initialUsedUnits: number,
  policy: ContextBudgetPolicy,
  format: (item: T) => string,
): { items: T[]; usedUnits: number } {
  const items: T[] = [];
  let usedUnits = initialUsedUnits;
  for (const rankedItem of ranked) {
    if (items.length >= maximumItems) {
      break;
    }
    const cost = policy.measure(format(rankedItem.item)) + TURN_ROLE_OVERHEAD_UNITS;
    if (usedUnits + cost > policy.maximumUnits) {
      continue;
    }
    items.push(rankedItem.item);
    usedUnits += cost;
  }
  return { items, usedUnits };
}

function buildSelectedSummary(entries: ReadonlyArray<ContextSummaryEntry>): string | null {
  return entries.length === 0 ? null : entries.map(formatSummaryEntry).join('\n\n');
}

function cloneConversationMessage(message: ConversationMessage): ConversationMessage {
  return {
    ...message,
    attachments: message.attachments.map((attachment) => ({ ...attachment })),
  };
}

function cloneContextTurn(turn: CanonicalContextTurn): CanonicalContextTurn {
  return { question: turn.question, answer: turn.answer };
}

function cloneMediaEvidence(evidence: ContextMediaEvidence): ContextMediaEvidence {
  return {
    ...evidence,
    facts: [...evidence.facts],
    extractedText: [...evidence.extractedText],
    uncertainty: [...evidence.uncertainty],
  };
}

function cloneMemoryFact(fact: ContextMemoryFact): ContextMemoryFact {
  return { ...fact };
}

function cloneSummaryEntry(entry: ContextSummaryEntry): ContextSummaryEntry {
  return { ...entry };
}

function cloneContextMemory(memory: ConversationContextMemory): ConversationContextMemory {
  return {
    version: 'conversation-context-memory-v1',
    sourceMessageCount: memory.sourceMessageCount,
    rollingSummary: memory.rollingSummary === null
      ? null
      : {
          ...memory.rollingSummary,
          sourceMessageIds: [...memory.rollingSummary.sourceMessageIds],
          entries: memory.rollingSummary.entries.map(cloneSummaryEntry),
        },
    importantFacts: memory.importantFacts.map(cloneMemoryFact),
    mediaEvidence: memory.mediaEvidence.map(cloneMediaEvidence),
  };
}

function cloneContextMemoryOrNull(
  memory: ConversationContextMemory | null | undefined,
): ConversationContextMemory | null {
  return memory?.version === 'conversation-context-memory-v1'
    ? cloneContextMemory(memory)
    : null;
}

function emptyContextMemory(): ConversationContextMemory {
  return {
    version: 'conversation-context-memory-v1',
    sourceMessageCount: 0,
    rollingSummary: null,
    importantFacts: [],
    mediaEvidence: [],
  };
}

function compactText(value: string, maximumChars: number): string {
  const normalized = value.trim();
  if (normalized.length <= maximumChars) {
    return normalized;
  }
  const marker = ' [...summary shortened...] ';
  const remaining = maximumChars - marker.length;
  const head = Math.ceil(remaining / 2);
  return `${normalized.slice(0, head).trimEnd()}${marker}${normalized
    .slice(-(remaining - head))
    .trimStart()}`;
}

function parseEvidenceTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNonEmptyString(value: string): boolean {
  return value.trim() !== '';
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(1, Math.floor(value));
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(0, Math.floor(value));
}
