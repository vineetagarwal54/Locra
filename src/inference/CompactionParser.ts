import type { DurableFactType } from '../types/models';

export interface ParsedSummary {
  readonly text: string;
  readonly sourceMessageIds: readonly string[];
}

export interface ParsedFact {
  readonly normalizedKey: string;
  readonly valueText: string;
  readonly factType: DurableFactType;
  readonly sourceMessageIds: readonly string[];
}

export interface ParsedCompaction {
  readonly summary: ParsedSummary;
  readonly facts: readonly ParsedFact[];
}

export function parseCompaction(raw: string, allowedMessageIds: ReadonlySet<string>): ParsedCompaction {
  const value: unknown = JSON.parse(extractJson(raw));
  if (!isRecord(value) || !isRecord(value.summary) || !Array.isArray(value.facts)) {
    throw new Error('Compaction output does not match the required schema.');
  }
  const summary = parseSummary(value.summary, allowedMessageIds);
  const facts = value.facts.map((fact) => parseFact(fact, allowedMessageIds));
  return { summary, facts };
}

function parseSummary(value: Record<string, unknown>, allowed: ReadonlySet<string>): ParsedSummary {
  return {
    text: requiredString(value.text, 'summary.text'),
    sourceMessageIds: validatedIds(value.sourceMessageIds, allowed),
  };
}

function parseFact(value: unknown, allowed: ReadonlySet<string>): ParsedFact {
  if (!isRecord(value)) {
    throw new Error('Compaction fact must be an object.');
  }
  const factType = value.factType;
  if (factType !== 'fact' && factType !== 'decision') {
    throw new Error('Compaction factType must be fact or decision.');
  }
  return {
    normalizedKey: requiredString(value.normalizedKey, 'fact.normalizedKey'),
    valueText: requiredString(value.valueText, 'fact.valueText'),
    factType,
    sourceMessageIds: validatedIds(value.sourceMessageIds, allowed),
  };
}

function validatedIds(value: unknown, allowed: ReadonlySet<string>): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string')) {
    throw new Error('Compaction sourceMessageIds must be a non-empty string array.');
  }
  const ids = [...new Set(value)];
  for (const id of ids) {
    if (!allowed.has(id)) {
      throw new Error(`Compaction referenced an unknown message ID: ${id}`);
    }
  }
  return ids;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Compaction ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function extractJson(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('Compaction output did not contain JSON.');
  }
  return raw.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
