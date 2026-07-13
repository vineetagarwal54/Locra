import type { ContextSelectionDiagnostics } from '../inference/ContextOrchestrator';
import type { InferenceTrace } from '../inference/InferenceTrace';
import type { ObjectiveInferenceResultRecord } from '../inference/ObjectiveInferenceResultRecord';
import { storage } from '../storage/mmkv';

export interface DiagnosticsStorage {
  set(key: string, value: string | number | boolean | ArrayBuffer): void;
  getString(key: string): string | undefined;
  remove(key: string): boolean;
}

export interface DiagnosticTurnRecord {
  id: string;
  conversationId: string;
  originatingUserMessageId: string;
  assistantMessageId: string;
  capturedAt: number;
  trace: InferenceTrace;
  objectiveResult: ObjectiveInferenceResultRecord | null;
  contextDiagnostics: ContextSelectionDiagnostics | null;
}

interface DiagnosticsIndexEntry {
  id: string;
  conversationId: string;
  capturedAt: number;
  sizeBytes: number;
}

const INDEX_KEY = 'diagnostics:turn:index';
const RECORD_KEY_PREFIX = 'diagnostics:turn:record:';

export const MAX_DIAGNOSTIC_TURNS_PER_CONVERSATION = 50;
export const MAX_DIAGNOSTIC_TURNS_OVERALL = 300;
export const MAX_DIAGNOSTIC_STORAGE_BYTES = 20 * 1024 * 1024;

export class DiagnosticsTraceStore {
  constructor(private readonly store: DiagnosticsStorage = storage) {}

  append(record: DiagnosticTurnRecord): void {
    const serialized = JSON.stringify(record);
    this.store.set(recordKey(record.id), serialized);

    const index = this.readIndex();
    index.push({
      id: record.id,
      conversationId: record.conversationId,
      capturedAt: record.capturedAt,
      sizeBytes: serialized.length,
    });
    this.evictAndWrite(index);
  }

  list(conversationIds?: ReadonlyArray<string>): DiagnosticTurnRecord[] {
    const filterSet = conversationIds === undefined ? null : new Set(conversationIds);
    const records: DiagnosticTurnRecord[] = [];

    for (const entry of this.readIndex()) {
      if (filterSet !== null && !filterSet.has(entry.conversationId)) {
        continue;
      }
      const record = this.readRecord(entry.id);
      if (record !== null) {
        records.push(record);
      }
    }

    return records.sort(
      (a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id),
    );
  }

  clear(): void {
    for (const entry of this.readIndex()) {
      this.store.remove(recordKey(entry.id));
    }
    this.store.remove(INDEX_KEY);
  }

  private evictAndWrite(rawIndex: DiagnosticsIndexEntry[]): void {
    const sorted = sortIndexEntries(rawIndex);
    const perConversation = evictPerConversationCap(sorted, MAX_DIAGNOSTIC_TURNS_PER_CONVERSATION);
    const overall = evictOverallCap(perConversation.kept, MAX_DIAGNOSTIC_TURNS_OVERALL);
    const bySize = evictBySizeCap(overall.kept, MAX_DIAGNOSTIC_STORAGE_BYTES);

    const evictedIds = [
      ...perConversation.evictedIds,
      ...overall.evictedIds,
      ...bySize.evictedIds,
    ];
    for (const id of evictedIds) {
      this.store.remove(recordKey(id));
    }
    this.store.set(INDEX_KEY, JSON.stringify(bySize.kept));
  }

  private readIndex(): DiagnosticsIndexEntry[] {
    const raw = this.store.getString(INDEX_KEY);
    if (raw === undefined) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isValidIndexEntry) : [];
    } catch {
      return [];
    }
  }

  private readRecord(id: string): DiagnosticTurnRecord | null {
    const raw = this.store.getString(recordKey(id));
    if (raw === undefined) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return isValidDiagnosticTurnRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export const diagnosticsTraceStore = new DiagnosticsTraceStore();

function recordKey(id: string): string {
  return `${RECORD_KEY_PREFIX}${id}`;
}

function sortIndexEntries(entries: DiagnosticsIndexEntry[]): DiagnosticsIndexEntry[] {
  return [...entries].sort(compareIndexEntries);
}

function compareIndexEntries(a: DiagnosticsIndexEntry, b: DiagnosticsIndexEntry): number {
  return a.capturedAt !== b.capturedAt ? a.capturedAt - b.capturedAt : a.id.localeCompare(b.id);
}

function evictPerConversationCap(
  sortedEntries: DiagnosticsIndexEntry[],
  maxPerConversation: number,
): { kept: DiagnosticsIndexEntry[]; evictedIds: string[] } {
  const buckets = new Map<string, DiagnosticsIndexEntry[]>();
  for (const entry of sortedEntries) {
    const bucket = buckets.get(entry.conversationId) ?? [];
    bucket.push(entry);
    buckets.set(entry.conversationId, bucket);
  }

  const evictedIds: string[] = [];
  const keptIds = new Set<string>();
  for (const bucket of buckets.values()) {
    const excess = bucket.length - maxPerConversation;
    for (let index = 0; index < bucket.length; index += 1) {
      if (index < excess) {
        evictedIds.push(bucket[index].id);
      } else {
        keptIds.add(bucket[index].id);
      }
    }
  }

  return { kept: sortedEntries.filter((entry) => keptIds.has(entry.id)), evictedIds };
}

function evictOverallCap(
  sortedEntries: DiagnosticsIndexEntry[],
  maxOverall: number,
): { kept: DiagnosticsIndexEntry[]; evictedIds: string[] } {
  if (sortedEntries.length <= maxOverall) {
    return { kept: sortedEntries, evictedIds: [] };
  }
  const excess = sortedEntries.length - maxOverall;
  return {
    kept: sortedEntries.slice(excess),
    evictedIds: sortedEntries.slice(0, excess).map((entry) => entry.id),
  };
}

function evictBySizeCap(
  sortedEntries: DiagnosticsIndexEntry[],
  maxBytes: number,
): { kept: DiagnosticsIndexEntry[]; evictedIds: string[] } {
  let total = sortedEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  let index = 0;
  const evictedIds: string[] = [];
  while (total > maxBytes && index < sortedEntries.length) {
    total -= sortedEntries[index].sizeBytes;
    evictedIds.push(sortedEntries[index].id);
    index += 1;
  }
  return { kept: sortedEntries.slice(index), evictedIds };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidIndexEntry(value: unknown): value is DiagnosticsIndexEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.conversationId === 'string' &&
    typeof value.capturedAt === 'number' &&
    typeof value.sizeBytes === 'number'
  );
}

function isValidDiagnosticTurnRecord(value: unknown): value is DiagnosticTurnRecord {
  if (!isRecord(value) || !isRecord(value.trace)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.conversationId === 'string' &&
    typeof value.originatingUserMessageId === 'string' &&
    typeof value.assistantMessageId === 'string' &&
    typeof value.capturedAt === 'number' &&
    Array.isArray(value.trace.stages)
  );
}
