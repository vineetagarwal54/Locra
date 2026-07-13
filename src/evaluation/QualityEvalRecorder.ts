import {
  type EvaluationResult,
  validateEvaluationResult,
  validateOfficialEvaluationResult,
} from './QualityEvalSchemas';

export interface ParseJsonlOptions {
  requireOfficial?: boolean;
}

export function formatEvaluationResultJsonl(result: EvaluationResult): string {
  const validation = validateEvaluationResult(result);
  if (!validation.ok) {
    throw new Error(`QualityEvalRecorder: invalid result (${validation.errors.join('; ')})`);
  }
  return JSON.stringify(result);
}

export function parseEvaluationResultJsonl(
  contents: string,
  options: ParseJsonlOptions = {}
): EvaluationResult[] {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => parseLine(line, index + 1, options));
}

export function appendManualScore(
  result: EvaluationResult,
  manualScore: EvaluationResult['manualScore']
): EvaluationResult {
  const next = { ...result, manualScore };
  const validation = validateEvaluationResult(next);
  if (!validation.ok) {
    throw new Error(`QualityEvalRecorder: invalid manual score (${validation.errors.join('; ')})`);
  }
  return next;
}

function parseLine(line: string, lineNumber: number, options: ParseJsonlOptions): EvaluationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`QualityEvalRecorder: line ${lineNumber} is not valid JSON (${describe(error)})`);
  }

  const validation = options.requireOfficial
    ? validateOfficialEvaluationResult(parsed)
    : validateEvaluationResult(parsed);
  if (!validation.ok) {
    throw new Error(
      `QualityEvalRecorder: line ${lineNumber} is invalid (${validation.errors.join('; ')})`
    );
  }
  return parsed as EvaluationResult;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
