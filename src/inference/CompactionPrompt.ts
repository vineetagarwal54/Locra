import type { MessageRow } from '../types/models';

export const COMPACTION_SYSTEM_PROMPT = [
  'You are Locra internal conversation compaction.',
  'Return JSON only. Do not answer the user.',
  'Preserve concrete facts and decisions and cite only provided message IDs.',
].join(' ');

export function buildCompactionPrompt(messages: readonly MessageRow[]): string {
  const transcript = messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
  }));
  return [
    'Compact this immutable older conversation range.',
    'Schema: {"summary":{"text":string,"sourceMessageIds":string[]},',
    '"facts":[{"normalizedKey":string,"valueText":string,"factType":"fact"|"decision",',
    '"sourceMessageIds":string[]}]}',
    JSON.stringify(transcript),
  ].join('\n');
}

