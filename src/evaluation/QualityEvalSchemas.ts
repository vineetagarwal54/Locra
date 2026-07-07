export const EVALUATION_CASE_SET_VERSION = 'cases.v1';

export const EVALUATION_CATEGORIES = [
  'visibleFacts',
  'textReading',
  'visualReasoning',
  'practicalAdvice',
  'activeFollowUpContext',
  'resumedConversationContext',
] as const;

export type EvaluationCategory = (typeof EVALUATION_CATEGORIES)[number];

export type EvaluationImageSource =
  | {
      type: 'repoAsset';
      path: string;
      licenseOrOrigin: string;
    }
  | {
      type: 'manualDeviceCapture';
      instructions: string;
      licenseOrOrigin: string;
    };

export interface EvaluationCase {
  caseId: string;
  category: EvaluationCategory;
  title: string;
  imageSource: EvaluationImageSource;
  question: string;
  followUps: string[];
  expectedCriteria: string[];
  tags: string[];
  officialDeviceRequired: boolean;
}

export interface ManualScore {
  directAnswer: boolean;
  coreCorrectness: boolean;
  hallucination: boolean;
  usefulness: number;
  notes?: string;
}

export interface EvaluationResult {
  caseId: string;
  variant: string;
  official: boolean;
  caseSetVersion: string;
  modelId: string;
  generationConfigId: string;
  deviceNameModel: string;
  appBuildId: string;
  output: string;
  perceptionLatencyMs: number;
  answerTtftMs: number;
  answerGenerationLatencyMs: number;
  totalEndToEndLatencyMs: number;
  generatedTokens: number;
  promptTokens?: number;
  looping: boolean;
  truncated: boolean;
  timestamp: string;
  manualScore?: ManualScore;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface CaseSetSummary {
  totalCases: number;
  repoAssetCases: number;
  repoAssetRatio: number;
  categoryCounts: Record<EvaluationCategory, number>;
}

const MIN_CASE_COUNT = 18;
const MIN_CASES_PER_CATEGORY = 3;
const MIN_REPO_ASSET_RATIO = 0.8;

export function validateEvaluationCase(value: unknown): ValidationResult {
  const errors: string[] = [];
  const record = asRecord(value);
  if (record === null) {
    return failed('case must be an object');
  }

  requireString(record, 'caseId', errors);
  requireCategory(record.category, errors);
  requireString(record, 'title', errors);
  requireImageSource(record.imageSource, errors);
  requireString(record, 'question', errors);
  requireStringArray(record, 'followUps', errors);
  requireStringArray(record, 'expectedCriteria', errors);
  requireStringArray(record, 'tags', errors);
  requireBoolean(record, 'officialDeviceRequired', errors);

  return { ok: errors.length === 0, errors };
}

export function validateEvaluationCaseSet(cases: readonly unknown[]): ValidationResult {
  const errors: string[] = [];
  const summary = summarizeCaseSet(cases);

  if (summary.totalCases < MIN_CASE_COUNT) {
    errors.push(`case set must include at least ${MIN_CASE_COUNT} cases`);
  }
  for (const category of EVALUATION_CATEGORIES) {
    if (summary.categoryCounts[category] < MIN_CASES_PER_CATEGORY) {
      errors.push(`category "${category}" must include at least ${MIN_CASES_PER_CATEGORY} cases`);
    }
  }
  if (summary.repoAssetRatio < MIN_REPO_ASSET_RATIO) {
    errors.push(`repo asset ratio must be at least ${MIN_REPO_ASSET_RATIO}`);
  }

  cases.forEach((item, index) => {
    const result = validateEvaluationCase(item);
    for (const error of result.errors) {
      errors.push(`case[${index}]: ${error}`);
    }
  });

  return { ok: errors.length === 0, errors };
}

export function summarizeCaseSet(cases: readonly unknown[]): CaseSetSummary {
  const categoryCounts = createEmptyCategoryCounts();
  let repoAssetCases = 0;

  for (const item of cases) {
    const record = asRecord(item);
    if (record === null) {
      continue;
    }
    if (isEvaluationCategory(record.category)) {
      categoryCounts[record.category] += 1;
    }
    const imageSource = asRecord(record.imageSource);
    if (imageSource?.type === 'repoAsset') {
      repoAssetCases += 1;
    }
  }

  return {
    totalCases: cases.length,
    repoAssetCases,
    repoAssetRatio: cases.length === 0 ? 0 : repoAssetCases / cases.length,
    categoryCounts,
  };
}

export function validateEvaluationResult(value: unknown): ValidationResult {
  const errors: string[] = [];
  const record = asRecord(value);
  if (record === null) {
    return failed('result must be an object');
  }

  requireString(record, 'caseId', errors);
  requireString(record, 'variant', errors);
  requireBoolean(record, 'official', errors);
  requireString(record, 'caseSetVersion', errors);
  requireString(record, 'modelId', errors);
  requireString(record, 'generationConfigId', errors);
  requireString(record, 'deviceNameModel', errors);
  requireString(record, 'appBuildId', errors);
  requireString(record, 'output', errors);
  requireNonNegativeNumber(record, 'perceptionLatencyMs', errors);
  requireNonNegativeNumber(record, 'answerTtftMs', errors);
  requireNonNegativeNumber(record, 'answerGenerationLatencyMs', errors);
  requireNonNegativeNumber(record, 'totalEndToEndLatencyMs', errors);
  requireNonNegativeNumber(record, 'generatedTokens', errors);
  if (record.promptTokens !== undefined) {
    requireNonNegativeNumber(record, 'promptTokens', errors);
  }
  requireBoolean(record, 'looping', errors);
  requireBoolean(record, 'truncated', errors);
  requireString(record, 'timestamp', errors);

  if (record.manualScore !== undefined) {
    errors.push(...validateManualScore(record.manualScore).errors.map((error) => `manualScore.${error}`));
  }

  return { ok: errors.length === 0, errors };
}

export function validateOfficialEvaluationResult(value: unknown): ValidationResult {
  const base = validateEvaluationResult(value);
  const record = asRecord(value);
  const errors = [...base.errors];
  if (record?.official !== true) {
    errors.push('official must be true for official artifacts');
  }
  return { ok: errors.length === 0, errors };
}

export function validateManualScore(value: unknown): ValidationResult {
  const errors: string[] = [];
  const record = asRecord(value);
  if (record === null) {
    return failed('must be an object');
  }

  requireBoolean(record, 'directAnswer', errors);
  requireBoolean(record, 'coreCorrectness', errors);
  requireBoolean(record, 'hallucination', errors);
  const usefulness = record.usefulness;
  if (
    typeof usefulness !== 'number' ||
    !Number.isInteger(usefulness) ||
    usefulness < 1 ||
    usefulness > 5
  ) {
    errors.push('usefulness must be an integer from 1 through 5');
  }
  if (record.notes !== undefined && typeof record.notes !== 'string') {
    errors.push('notes must be a string when provided');
  }

  return { ok: errors.length === 0, errors };
}

export function isEvaluationCategory(value: unknown): value is EvaluationCategory {
  return typeof value === 'string' && EVALUATION_CATEGORIES.includes(value as EvaluationCategory);
}

function createEmptyCategoryCounts(): Record<EvaluationCategory, number> {
  return {
    visibleFacts: 0,
    textReading: 0,
    visualReasoning: 0,
    practicalAdvice: 0,
    activeFollowUpContext: 0,
    resumedConversationContext: 0,
  };
}

function requireCategory(value: unknown, errors: string[]): void {
  if (!isEvaluationCategory(value)) {
    errors.push(`category must be one of ${EVALUATION_CATEGORIES.join(', ')}`);
  }
}

function requireImageSource(value: unknown, errors: string[]): void {
  const source = asRecord(value);
  if (source === null) {
    errors.push('imageSource must be an object');
    return;
  }
  if (source.type === 'repoAsset') {
    requireString(source, 'path', errors);
    requireString(source, 'licenseOrOrigin', errors);
    return;
  }
  if (source.type === 'manualDeviceCapture') {
    requireString(source, 'instructions', errors);
    requireString(source, 'licenseOrOrigin', errors);
    return;
  }
  errors.push('imageSource.type must be repoAsset or manualDeviceCapture');
}

function requireString(record: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof record[key] !== 'string' || (record[key] as string).trim() === '') {
    errors.push(`${key} must be a non-empty string`);
  }
}

function requireStringArray(record: Record<string, unknown>, key: string, errors: string[]): void {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    errors.push(`${key} must be a string array`);
  }
}

function requireBoolean(record: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof record[key] !== 'boolean') {
    errors.push(`${key} must be a boolean`);
  }
}

function requireNonNegativeNumber(
  record: Record<string, unknown>,
  key: string,
  errors: string[]
): void {
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key]) || (record[key] as number) < 0) {
    errors.push(`${key} must be a non-negative number`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function failed(error: string): ValidationResult {
  return { ok: false, errors: [error] };
}
