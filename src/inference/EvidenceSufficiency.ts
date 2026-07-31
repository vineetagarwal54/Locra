import type { ImageEntity } from '../persistence/ImageEntityRepository';
import type {
  NumericEvidenceKind,
  StructuredImageEvidence,
  StructuredImageEvidenceStatus,
} from '../persistence/StructuredImageEvidenceRepository';

export type EvidenceRequirement =
  | 'general'
  | 'readable-text'
  | 'price'
  | 'date'
  | 'serial'
  | 'count'
  | 'color'
  | 'shape'
  | 'location'
  | 'damage'
  | 'map-identity'
  | 'fine-detail';

export type EvidenceSufficiencyReason =
  | 'missing-evidence'
  | 'stale-evidence'
  | 'partial-evidence'
  | 'failed-evidence'
  | 'general-evidence-covered'
  | 'general-evidence-missing'
  | 'readable-text-covered'
  | 'readable-text-missing'
  | 'price-field-covered'
  | 'price-field-missing'
  | 'date-field-covered'
  | 'date-field-missing'
  | 'serial-field-covered'
  | 'serial-field-missing'
  | 'count-field-covered'
  | 'count-field-missing'
  | 'color-detail-covered'
  | 'color-detail-missing'
  | 'shape-detail-covered'
  | 'shape-detail-missing'
  | 'location-detail-covered'
  | 'location-detail-missing'
  | 'damage-detail-covered'
  | 'damage-detail-missing'
  | 'map-identity-covered'
  | 'map-identity-missing'
  | 'fine-detail-requires-pixels';

export type EvidenceObservedStatus =
  | StructuredImageEvidenceStatus
  | 'missing';

export interface EvidenceSufficiencyResult {
  readonly sufficient: boolean;
  readonly requirement: EvidenceRequirement;
  readonly reason: EvidenceSufficiencyReason;
  readonly evidenceStatus: EvidenceObservedStatus;
}

const COLOR_TERMS = new Set([
  'black', 'blue', 'brown', 'gray', 'green', 'grey', 'orange', 'pink',
  'purple', 'red', 'tan', 'teal', 'white', 'yellow',
]);
const SHAPE_TERMS = new Set([
  'circle', 'circular', 'oval', 'rectangle', 'rectangular', 'round',
  'square', 'triangle', 'triangular',
]);
const LOCATION_TERMS = new Set([
  'above', 'below', 'bottom', 'center', 'left', 'middle', 'near', 'right', 'top',
]);
const DAMAGE_TERMS = new Set([
  'bent', 'broken', 'burned', 'chipped', 'cracked', 'damaged', 'dented',
  'frayed', 'scratched', 'stained', 'torn', 'worn',
]);

export function evaluateEvidenceSufficiency(input: {
  readonly question: string;
  readonly image: ImageEntity;
  readonly evidence: StructuredImageEvidence | null;
}): EvidenceSufficiencyResult {
  const requirement = requirementForQuestion(input.question);
  const evidence = input.evidence;
  if (evidence === null) {
    return insufficient(requirement, 'missing-evidence', 'missing');
  }
  if (
    evidence.status === 'stale'
    || (
      evidence.sourceRevision !== input.image.assetRevision
      && !evidence.sourceRevision.startsWith(`${input.image.assetRevision}:`)
    )
  ) {
    return insufficient(requirement, 'stale-evidence', 'stale');
  }
  if (evidence.status === 'failed') {
    return insufficient(requirement, 'failed-evidence', 'failed');
  }
  if (evidence.status === 'partial') {
    return insufficient(requirement, 'partial-evidence', 'partial');
  }

  if (requirement === 'readable-text') {
    return coverage(
      requirement,
      hasGenuineReadableText(evidence),
      'readable-text-covered',
      'readable-text-missing',
    );
  }
  if (isNumericRequirement(requirement)) {
    return numericCoverage(requirement, evidence);
  }
  if (requirement === 'fine-detail') {
    return insufficient(requirement, 'fine-detail-requires-pixels', evidence.status);
  }
  if (requirement === 'map-identity') {
    const covered = hasGenuineReadableText(evidence)
      && containsAnyToken(evidence.summary, new Set(['map', 'route', 'street', 'trail']));
    return coverage(
      requirement,
      covered,
      'map-identity-covered',
      'map-identity-missing',
    );
  }
  if (requirement !== 'general') {
    const details = structuredDetails(evidence);
    const termSet = requirement === 'color'
      ? COLOR_TERMS
      : requirement === 'shape'
        ? SHAPE_TERMS
        : requirement === 'location'
          ? LOCATION_TERMS
          : DAMAGE_TERMS;
    return coverage(
      requirement,
      details.some((detail) => containsAnyToken(detail, termSet)),
      `${requirement}-detail-covered`,
      `${requirement}-detail-missing`,
    );
  }

  return coverage(
    requirement,
    evidence.summary.trim() !== ''
      || evidence.visibleObjects.length > 0,
    'general-evidence-covered',
    'general-evidence-missing',
  );
}

export function requirementForQuestion(question: string): EvidenceRequirement {
  const tokens = questionTokens(question);
  if (hasAny(tokens, ['price', 'prices', 'cost', 'costs'])) return 'price';
  if (hasAny(tokens, ['date', 'dated', 'expiry', 'expiration'])) return 'date';
  if (hasAny(tokens, ['serial', 'sku'])) return 'serial';
  if (
    hasAny(tokens, ['count', 'counts', 'quantity'])
    || hasPhrase(tokens, ['how', 'many'])
    || hasPhrase(tokens, ['number', 'of'])
  ) return 'count';
  if (
    hasAny(tokens, ['ocr', 'transcribe', 'text', 'words', 'characters'])
    || hasAny(tokens, ['read', 'reads', 'says'])
  ) return 'readable-text';
  if (hasAny(tokens, ['color', 'colour'])) return 'color';
  if (hasAny(tokens, ['shape'])) return 'shape';
  if (hasAny(tokens, ['location', 'position', 'where'])) return 'location';
  if (hasAny(tokens, ['damage', 'damaged', 'defect', 'broken'])) return 'damage';
  if (hasAny(tokens, ['map', 'route', 'street', 'trail'])) return 'map-identity';
  if (hasAny(tokens, ['detail', 'details', 'fine', 'tiny', 'precise'])) return 'fine-detail';
  return 'general';
}

function numericCoverage(
  requirement: 'price' | 'date' | 'serial' | 'count',
  evidence: StructuredImageEvidence,
): EvidenceSufficiencyResult {
  const kind: NumericEvidenceKind = requirement;
  const covered = evidence.numericValues.some((value) => value.kind === kind);
  return coverage(
    requirement,
    covered,
    `${requirement}-field-covered`,
    `${requirement}-field-missing`,
  );
}

function hasGenuineReadableText(evidence: StructuredImageEvidence): boolean {
  const objectLabels = new Set(
    evidence.visibleObjects.map((object) => object.label.trim().toLocaleLowerCase()),
  );
  return evidence.extractedText.some((span) => {
    const text = span.text.trim();
    return text !== ''
      && /[a-z0-9]/i.test(text)
      && !objectLabels.has(text.toLocaleLowerCase());
  });
}

function structuredDetails(evidence: StructuredImageEvidence): string[] {
  return [
    evidence.summary,
    ...evidence.visibleObjects.flatMap((object) => [object.label, ...object.attributes]),
    ...evidence.extractedText.map((span) => span.text),
  ];
}

function coverage<R extends EvidenceSufficiencyReason>(
  requirement: EvidenceRequirement,
  sufficient: boolean,
  coveredReason: R,
  missingReason: EvidenceSufficiencyReason,
): EvidenceSufficiencyResult {
  return {
    sufficient,
    requirement,
    reason: sufficient ? coveredReason : missingReason,
    evidenceStatus: 'complete',
  };
}

function insufficient(
  requirement: EvidenceRequirement,
  reason: EvidenceSufficiencyReason,
  evidenceStatus: EvidenceObservedStatus,
): EvidenceSufficiencyResult {
  return { sufficient: false, requirement, reason, evidenceStatus };
}

function isNumericRequirement(
  requirement: EvidenceRequirement,
): requirement is 'price' | 'date' | 'serial' | 'count' {
  return requirement === 'price'
    || requirement === 'date'
    || requirement === 'serial'
    || requirement === 'count';
}

function questionTokens(value: string): string[] {
  return value.toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token !== '');
}

function containsAnyToken(value: string, candidates: ReadonlySet<string>): boolean {
  return questionTokens(value).some((token) => candidates.has(token));
}

function hasAny(tokens: readonly string[], candidates: readonly string[]): boolean {
  const tokenSet = new Set(tokens);
  return candidates.some((candidate) => tokenSet.has(candidate));
}

function hasPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  for (let index = 0; index <= tokens.length - phrase.length; index += 1) {
    if (phrase.every((token, offset) => tokens[index + offset] === token)) return true;
  }
  return false;
}
