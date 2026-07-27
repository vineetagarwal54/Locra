import type { CanonicalConversationContext } from '../types/models';

import {
  createGroundingSourceSet,
  type GroundingSourceSet,
} from './GroundingSourceSet';
import type { HiddenVisualEvidence } from './OutputPipelineTypes';

export { createGroundingSourceSet };
export type { GroundingSourceSet };

export type GroundingVerdict = 'supported' | 'unsupported' | null;

export function assessGrounding(
  answer: string,
  context: CanonicalConversationContext,
  freshEvidence: HiddenVisualEvidence | null = null,
): GroundingVerdict {
  return assessGroundingFromSources(
    answer,
    createGroundingSourceSet(context, freshEvidence, inferCurrentConversationId(context)),
  );
}

export function assessGroundingFromSources(
  answer: string,
  sourceSet: GroundingSourceSet,
): GroundingVerdict {
  const evidence = sourceSet.sources.map((source) => source.content).join(' ').toLowerCase();
  if (evidence.trim() === '') {
    return null;
  }

  const claims = extractSpecificClaims(answer);
  if (claims.length === 0) {
    return 'supported';
  }
  return claims.every((claim) => evidence.includes(claim.toLowerCase()))
    ? 'supported'
    : 'unsupported';
}

function inferCurrentConversationId(context: CanonicalConversationContext): string | null {
  const retrieved = context.importantFacts.find((fact) => fact.id.startsWith('retrieved:'));
  return retrieved?.id.split(':')[1] ?? null;
}

export function extractSpecificClaims(text: string): string[] {
  const numbersAndDates = text.match(
    /(?:[$€£]\s?\d+(?:[.,]\d+)*|\b\d{1,4}(?:[-/.]\d{1,2}){1,2}\b|\b\d+(?:[.,]\d+)*\b)/g,
  ) ?? [];
  const identifiers = text.match(
    /\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g,
  ) ?? [];
  return [...new Set([...numbersAndDates, ...identifiers])];
}
