import { buildExtractionRetryPrompt } from './ExtractionPrompt';
import type { HiddenVisualEvidence } from './OutputPipelineTypes';

export interface ExtractionFindings {
  subjectObject: string;
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
  const trimmed = rawText.trim();
  if (trimmed === '') {
    return { ok: false, rawText };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) {
      return { ok: false, rawText };
    }

    const subjectObject = readRequiredString(parsed, 'subjectObject');
    const visibleCondition = readRequiredString(parsed, 'visibleCondition');
    if (subjectObject === null || visibleCondition === null) {
      return { ok: false, rawText };
    }

    return {
      ok: true,
      findings: {
        subjectObject,
        visibleFeatures: readStringArray(parsed, 'visibleFeatures'),
        visibleText: readStringArray(parsed, 'visibleText'),
        visibleCondition,
        uncertainty: readStringArray(parsed, 'uncertainty'),
      },
    };
  } catch {
    return { ok: false, rawText };
  }
}

export async function parseExtractionWithRetry(
  rawText: string,
  retry: ExtractionRetry,
  userQuestion: string,
  imagePath = ''
): Promise<ExtractionOutcome> {
  const firstParse = parseExtractionResponse(rawText);
  if (firstParse.ok) {
    return buildSuccessfulOutcome(firstParse.findings, userQuestion, imagePath);
  }

  const retryPrompt = buildExtractionRetryPrompt(rawText, userQuestion);
  const retryText = await retry(retryPrompt);
  const retryParse = parseExtractionResponse(retryText);
  if (retryParse.ok) {
    return buildSuccessfulOutcome(retryParse.findings, userQuestion, imagePath);
  }

  return {
    pinnedExtraction: 'Visual evidence unavailable: Locra could not extract reliable structured visual evidence.',
    visibleAnswer:
      "I couldn't extract reliable visual evidence from this image, so I can't answer confidently from the picture. Try retaking the image with the subject centered and well lit.",
    hiddenEvidence: null,
    usedFallback: true,
  };
}

export function formatExtractionAnswer(findings: ExtractionFindings): string {
  return [
    `Subject/object: ${findings.subjectObject}`,
    `Visible features: ${formatList(findings.visibleFeatures)}`,
    `Visible text: ${formatList(findings.visibleText)}`,
    `Visible condition: ${findings.visibleCondition}`,
  ].join('\n');
}

function readRequiredString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
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
      visibleFeatures: findings.visibleFeatures,
      visibleText: findings.visibleText,
      visibleCondition: findings.visibleCondition,
      uncertainty: findings.uncertainty,
      createdAt: new Date().toISOString(),
    },
    usedFallback: false,
  };
}
