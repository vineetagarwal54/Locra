import type { CanonicalConversationContext } from '../types/models';

import type { HiddenVisualEvidence } from './OutputPipelineTypes';

export type GroundingVerdict = 'supported' | 'unsupported' | null;

export function assessGrounding(
  answer: string,
  context: CanonicalConversationContext,
  freshEvidence: HiddenVisualEvidence | null = null,
): GroundingVerdict {
  const evidence = [
    ...context.mediaEvidence.flatMap((item) => [
      item.summary,
      ...item.facts,
      ...item.extractedText,
    ]),
    ...context.importantFacts
      .filter((fact) => fact.id.startsWith('retrieved:'))
      .map((fact) => fact.text),
    ...(freshEvidence === null
      ? []
      : [
          freshEvidence.subjectObject,
          ...freshEvidence.visibleFeatures,
          ...freshEvidence.visibleText,
          freshEvidence.visibleCondition,
          ...freshEvidence.uncertainty,
        ]),
  ].join(' ').toLowerCase();
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

export function extractSpecificClaims(text: string): string[] {
  const numbersAndDates = text.match(
    /(?:[$€£]\s?\d+(?:[.,]\d+)*|\b\d{1,4}(?:[-/.]\d{1,2}){1,2}\b|\b\d+(?:[.,]\d+)*\b)/g,
  ) ?? [];
  const identifiers = text.match(
    /\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g,
  ) ?? [];
  return [...new Set([...numbersAndDates, ...identifiers])];
}
