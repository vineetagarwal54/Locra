import type { FactRepository } from '../persistence/FactRepository';
import type { MessageRepository } from '../persistence/MessageRepository';
import type { SummaryRepository } from '../persistence/SummaryRepository';
import type { MessageRow, SummaryRow } from '../types/models';

import { parseCompaction } from './CompactionParser';
import { buildCompactionPrompt, COMPACTION_SYSTEM_PROMPT } from './CompactionPrompt';
import { deviceResourcePolicy, type DeviceResourcePolicy } from './DeviceResourcePolicy';
import { getRegisteredInferenceEngine } from './InferenceEngineRegistry';

export const COMPACTION_MESSAGE_TRIGGER = 24;
export const COMPACTION_CHARACTER_TRIGGER = 6_000;
export const COMPACTION_RECENT_MESSAGE_WINDOW = 32;
export const CURRENT_SUMMARIZER_VERSION = 'qwen-compaction-v1';

export interface CompactionRange {
  readonly messages: readonly MessageRow[];
  readonly sourceViewHash: string;
}

export interface CompactionGenerator {
  generate(prompt: string): Promise<string>;
}

export type CompactionChange =
  | { readonly kind: 'append'; readonly messageId: string }
  | { readonly kind: 'delete' | 'source-view' | 'active-attempt'; readonly messageId: string }
  | { readonly kind: 'summarizer-version'; readonly version: string };

export interface CompactionServiceDeps {
  readonly messages: Pick<MessageRepository, 'getCanonicalProjection'>;
  readonly summaries: Pick<SummaryRepository, 'getNewestReady' | 'save' | 'markStale'>;
  readonly facts: Pick<FactRepository, 'upsert'>;
  readonly generator: CompactionGenerator;
  readonly resourcePolicy?: DeviceResourcePolicy;
  readonly summarizerVersion?: string;
}

export class CompactionService {
  private readonly resourcePolicy: DeviceResourcePolicy;
  private readonly summarizerVersion: string;

  constructor(private readonly deps: CompactionServiceDeps) {
    this.resourcePolicy = deps.resourcePolicy ?? deviceResourcePolicy;
    this.summarizerVersion = deps.summarizerVersion ?? CURRENT_SUMMARIZER_VERSION;
  }

  async maybeRun(conversationId: string): Promise<boolean> {
    const projection = this.deps.messages.getCanonicalProjection(conversationId);
    const range = selectCompactionRange(projection);
    if (range === null) {
      return false;
    }
    const current = this.deps.summaries.getNewestReady(conversationId, this.summarizerVersion);
    const last = range.messages.at(-1);
    if (last === undefined) {
      return false;
    }
    if (current?.last_source_message_id === last.id &&
        current.source_view_hash === range.sourceViewHash) {
      return false;
    }

    const lease = await this.resourcePolicy.acquire('qwen-compaction');
    try {
      const raw = await this.deps.generator.generate(buildCompactionPrompt(range.messages));
      const allowedIds = new Set(range.messages.map((message) => message.id));
      const parsed = parseCompaction(raw, allowedIds);
      const first = range.messages[0];
      if (first === undefined) {
        return false;
      }
      this.deps.summaries.save({
        conversationId,
        firstSourceMessageId: first.id,
        lastSourceMessageId: last.id,
        sourceViewHash: range.sourceViewHash,
        summarizerVersion: this.summarizerVersion,
        text: parsed.summary.text,
      });
      for (const fact of parsed.facts) {
        this.deps.facts.upsert({
          conversationId,
          normalizedKey: fact.normalizedKey,
          valueText: fact.valueText,
          factType: fact.factType,
          extractionVersion: this.summarizerVersion,
          sourceViewHash: range.sourceViewHash,
          sourceMessageIds: fact.sourceMessageIds,
        });
      }
      return true;
    } finally {
      lease.release();
    }
  }

  markStaleForChange(conversationId: string, change: CompactionChange): void {
    const summary = this.deps.summaries.getNewestReady(conversationId);
    if (summary === null) {
      return;
    }
    const ids = this.deps.messages.getCanonicalProjection(conversationId).map((message) => message.id);
    if (shouldStaleSummary(summary, ids, change, this.summarizerVersion)) {
      this.deps.summaries.markStale(summary.id);
    }
  }
}

export function selectCompactionRange(projection: readonly MessageRow[]): CompactionRange | null {
  const older = projection.slice(0, Math.max(0, projection.length - COMPACTION_RECENT_MESSAGE_WINDOW));
  if (!meetsCompactionTrigger(older)) {
    return null;
  }
  return { messages: older, sourceViewHash: hashSourceView(older) };
}

export function meetsCompactionTrigger(messages: readonly MessageRow[]): boolean {
  return messages.length >= COMPACTION_MESSAGE_TRIGGER ||
    messages.reduce((total, message) => total + message.text.length, 0) >=
      COMPACTION_CHARACTER_TRIGGER;
}

export function shouldStaleSummary(
  summary: SummaryRow,
  orderedMessageIds: readonly string[],
  change: CompactionChange,
  currentSummarizerVersion: string,
): boolean {
  if (change.kind === 'append') {
    return false;
  }
  if (change.kind === 'summarizer-version') {
    return change.version !== summary.summarizer_version ||
      currentSummarizerVersion !== summary.summarizer_version;
  }
  const first = orderedMessageIds.indexOf(summary.first_source_message_id);
  const last = orderedMessageIds.indexOf(summary.last_source_message_id);
  const changed = orderedMessageIds.indexOf(change.messageId);
  if (first < 0 || last < 0) {
    return true;
  }
  return changed < 0 || (changed >= first && changed <= last);
}

export function createRegisteredEngineCompactionGenerator(): CompactionGenerator {
  return {
    generate: async (prompt: string): Promise<string> => {
      const engine = getRegisteredInferenceEngine();
      if (engine === null || !engine.isReady()) {
        throw new Error('The on-device model is not ready for compaction.');
      }
      engine.clearHistory();
      try {
        return await engine.generate({
          messages: [
            { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          responseMode: 'Low',
          kind: 'compaction',
        });
      } finally {
        engine.clearHistory();
      }
    },
  };
}

function hashSourceView(messages: readonly MessageRow[]): string {
  let hash = 2166136261;
  for (const message of messages) {
    const value = `${message.id}\u0000${message.text}\u0000${message.status}\u0000`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

