import type { HiddenVisualEvidence } from './OutputPipelineTypes';

export const STRUCTURED_VISUAL_EXTRACTION_SCHEMA_VERSION =
  'structured-visual-extraction-v2';

export const STRUCTURED_VISUAL_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'subjectObject',
    'visibleObjects',
    'visibleFeatures',
    'visibleText',
    'visibleCondition',
    'uncertainty',
  ],
  properties: {
    subjectObject: { type: 'string', minLength: 1, maxLength: 160 },
    visibleObjects: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string', minLength: 1, maxLength: 80 },
    },
    visibleFeatures: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string', minLength: 1, maxLength: 160 },
    },
    visibleText: {
      type: 'array',
      maxItems: 16,
      items: { type: 'string', minLength: 1, maxLength: 160 },
    },
    visibleCondition: { type: 'string', minLength: 1, maxLength: 160 },
    uncertainty: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 160 },
    },
  },
} as const;

export interface StructuredVisualFindings {
  readonly subjectObject: string;
  readonly visibleObjects: readonly string[];
  readonly visibleFeatures: readonly string[];
  readonly visibleText: readonly string[];
  readonly visibleCondition: string;
  readonly uncertainty: readonly string[];
}

export function normalizeStructuredVisualFindings(
  value: unknown,
): StructuredVisualFindings | null {
  if (!isRecord(value)) return null;
  const allowedKeys = new Set<string>(STRUCTURED_VISUAL_EXTRACTION_JSON_SCHEMA.required);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;

  const subjectObject = boundedString(value.subjectObject, 160);
  const visibleObjects = boundedStringArray(value.visibleObjects, 12, 80);
  const visibleFeatures = boundedStringArray(value.visibleFeatures, 12, 160);
  const visibleText = boundedStringArray(value.visibleText, 16, 160);
  const visibleCondition = boundedString(value.visibleCondition, 160);
  const uncertainty = boundedStringArray(value.uncertainty, 8, 160);
  if (
    subjectObject === null
    || visibleObjects === null
    || visibleFeatures === null
    || visibleText === null
    || visibleCondition === null
    || uncertainty === null
  ) {
    return null;
  }
  return {
    subjectObject,
    visibleObjects,
    visibleFeatures,
    visibleText,
    visibleCondition,
    uncertainty,
  };
}

export function normalizeHiddenVisualEvidence(
  evidence: HiddenVisualEvidence,
): StructuredVisualFindings | null {
  return normalizeStructuredVisualFindings({
    subjectObject: evidence.subjectObject,
    visibleObjects: evidence.visibleObjects ?? [evidence.subjectObject],
    visibleFeatures: evidence.visibleFeatures,
    visibleText: evidence.visibleText,
    visibleCondition: evidence.visibleCondition,
    uncertainty: evidence.uncertainty,
  });
}

function boundedString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (
    normalized === ''
    || normalized.length > maximumLength
    || isRepetitiveText(normalized)
  ) {
    return null;
  }
  return normalized;
}

function boundedStringArray(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const normalized: string[] = [];
  const unique = new Set<string>();
  for (const item of value) {
    const bounded = boundedString(item, maximumLength);
    if (bounded === null) return null;
    const key = bounded.toLocaleLowerCase();
    if (!unique.has(key)) {
      unique.add(key);
      normalized.push(bounded);
    }
  }
  if (value.length >= 6 && unique.size * 3 <= value.length) return null;
  return normalized;
}

function isRepetitiveText(value: string): boolean {
  const tokens = value.toLocaleLowerCase().split(' ').filter((token) => token !== '');
  if (tokens.length < 8) return false;
  return new Set(tokens).size * 4 <= tokens.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
