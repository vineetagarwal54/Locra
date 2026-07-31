import { buildExtractionRetryPrompt } from './ExtractionPrompt';
import type { HiddenVisualEvidence } from './OutputPipelineTypes';
import { normalizeStructuredVisualFindings } from './StructuredVisualExtraction';

export interface ExtractionFindings {
  subjectObject: string;
  visibleObjects: string[];
  visibleFeatures: string[];
  visibleText: string[];
  visibleCondition: string;
  uncertainty: string[];
}

export type ExtractionParseResult =
  | { ok: true; findings: ExtractionFindings }
  | { ok: false; rawText: string };

export interface ExtractionOutcome {
  pinnedExtraction: string;
  visibleAnswer: string;
  hiddenEvidence: HiddenVisualEvidence | null;
  usedFallback: boolean;
}

export type ExtractionRetry = (prompt: string) => Promise<string>;

export function parseExtractionResponse(rawText: string): ExtractionParseResult {
  const trimmed = extractJsonObject(rawText);
  if (trimmed === '') {
    return { ok: false, rawText };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) {
      return { ok: false, rawText };
    }

    const normalized = normalizeStructuredVisualFindings(parsed);
    if (normalized === null) return { ok: false, rawText };

    return {
      ok: true,
      findings: {
        subjectObject: normalized.subjectObject,
        visibleObjects: [...normalized.visibleObjects],
        visibleFeatures: [...normalized.visibleFeatures],
        visibleText: normalized.visibleText.filter(
          (text) => !duplicatesVisibleObjectLabel(
            text,
            normalized.visibleObjects,
            normalized.visibleFeatures,
          ),
        ),
        visibleCondition: normalized.visibleCondition,
        uncertainty: [...normalized.uncertainty],
      },
    };
  } catch {
    return { ok: false, rawText };
  }
}

function duplicatesVisibleObjectLabel(
  text: string,
  visibleObjects: readonly string[],
  visibleFeatures: readonly string[],
): boolean {
  const normalizedText = text.toLocaleLowerCase();
  if (!/^[a-z][a-z -]*$/i.test(text)) return false;
  return [...visibleObjects, ...visibleFeatures].some((label) => {
    const normalizedLabel = label.toLocaleLowerCase();
    return normalizedLabel === normalizedText
      || (
        !normalizedText.includes(' ')
        && normalizedLabel.split(/[^a-z0-9]+/).includes(normalizedText)
      );
  });
}

export async function parseExtractionWithRetry(
  rawText: string,
  retry: ExtractionRetry,
  userQuestion: string,
  imagePath = '',
  options: { readonly allowRetry?: boolean } = {},
): Promise<ExtractionOutcome> {
  const firstParse = parseExtractionResponse(rawText);
  if (firstParse.ok) {
    return buildSuccessfulOutcome(firstParse.findings, userQuestion, imagePath);
  }

  if ((options.allowRetry ?? true) && isFormattingRepairCandidate(rawText)) {
    const retryPrompt = buildExtractionRetryPrompt(rawText, userQuestion);
    const retryText = await retry(retryPrompt);
    const retryParse = parseExtractionResponse(retryText);
    if (retryParse.ok) {
      return buildSuccessfulOutcome(retryParse.findings, userQuestion, imagePath);
    }
  }

  return {
    pinnedExtraction: 'Visual evidence unavailable: Locra could not extract reliable structured visual evidence.',
    visibleAnswer:
      "I couldn't extract reliable visual evidence from this image, so I can't answer confidently from the picture. Try retaking the image with the subject centered and well lit.",
    hiddenEvidence: null,
    usedFallback: true,
  };
}

function extractJsonObject(rawText: string): string {
  const unfenced = rawText.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  return firstBrace >= 0 && lastBrace > firstBrace
    ? unfenced.slice(firstBrace, lastBrace + 1)
    : unfenced;
}

function isFormattingRepairCandidate(rawText: string): boolean {
  if (rawText.length > 2_000) return false;
  const trimmed = rawText.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  try {
    JSON.parse(trimmed);
    return false;
  } catch {
    // Only a structurally different formatting repair may follow malformed JSON.
  }
  const normalized = trimmed.toLowerCase();
  return [
    'subjectobject',
    'visibleobjects',
    'visiblefeatures',
    'visibletext',
    'visiblecondition',
    'uncertainty',
  ].every((key) => normalized.includes(key));
}

export function formatExtractionAnswer(findings: ExtractionFindings): string {
  return [
    `Subject/object: ${findings.subjectObject}`,
    `Visible objects: ${formatList(findings.visibleObjects)}`,
    `Visible features: ${formatList(findings.visibleFeatures)}`,
    `Visible text: ${formatList(findings.visibleText)}`,
    `Visible condition: ${findings.visibleCondition}`,
  ].join('\n');
}

function formatList(values: string[]): string {
  return values.length === 0 ? 'None visible' : values.join(', ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildSuccessfulOutcome(
  findings: ExtractionFindings,
  userQuestion: string,
  imagePath: string
): ExtractionOutcome {
  const pinnedExtraction = formatExtractionAnswer(findings);
  return {
    pinnedExtraction,
    visibleAnswer: pinnedExtraction,
    hiddenEvidence: {
      version: 'hidden-evidence-v1',
      imagePath,
      sourceQuestion: userQuestion,
      subjectObject: findings.subjectObject,
      visibleObjects: findings.visibleObjects,
      visibleFeatures: findings.visibleFeatures,
      visibleText: findings.visibleText,
      visibleCondition: findings.visibleCondition,
      uncertainty: findings.uncertainty,
      createdAt: new Date().toISOString(),
    },
    usedFallback: false,
  };
}
