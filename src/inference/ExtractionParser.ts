import { buildExtractionRetryPrompt } from './ExtractionPrompt';

export interface ExtractionFindings {
  subjectObject: string;
  visibleFeatures: string[];
  visibleText: string[];
  visibleCondition: string;
}

export type ExtractionParseResult =
  | { ok: true; findings: ExtractionFindings }
  | { ok: false; rawText: string };

export interface ExtractionOutcome {
  pinnedExtraction: string;
  visibleAnswer: string;
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
      },
    };
  } catch {
    return { ok: false, rawText };
  }
}

export async function parseExtractionWithRetry(
  rawText: string,
  retry: ExtractionRetry,
  userQuestion: string
): Promise<ExtractionOutcome> {
  const firstParse = parseExtractionResponse(rawText);
  if (firstParse.ok) {
    const answer = formatExtractionAnswer(firstParse.findings);
    return { pinnedExtraction: answer, visibleAnswer: answer, usedFallback: false };
  }

  const retryPrompt = buildExtractionRetryPrompt(rawText, userQuestion);
  const retryText = await retry(retryPrompt);
  const retryParse = parseExtractionResponse(retryText);
  if (retryParse.ok) {
    const answer = formatExtractionAnswer(retryParse.findings);
    return { pinnedExtraction: answer, visibleAnswer: answer, usedFallback: false };
  }

  const fallback = rawText.trim() === '' ? 'No structured visual extraction was produced.' : rawText.trim();
  return { pinnedExtraction: fallback, visibleAnswer: fallback, usedFallback: true };
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
