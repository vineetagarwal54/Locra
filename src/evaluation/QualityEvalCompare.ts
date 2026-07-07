import type { EvaluationResult } from './QualityEvalSchemas';

export type ComparisonStatus = 'improved' | 'regressed' | 'unchanged' | 'candidate-only';

export interface CaseComparison {
  caseId: string;
  baselineVariant: string | null;
  candidateVariant: string;
  status: ComparisonStatus;
  usefulnessDelta: number | null;
  baselineOutput: string | null;
  candidateOutput: string;
}

export interface EvaluationComparisonSummary {
  sharedCases: number;
  improved: number;
  regressed: number;
  unchanged: number;
  candidateOnly: number;
}

export interface EvaluationComparison {
  cases: CaseComparison[];
  summary: EvaluationComparisonSummary;
}

export function compareEvaluationResults(
  baseline: readonly EvaluationResult[],
  candidate: readonly EvaluationResult[]
): EvaluationComparison {
  requireOfficialResults(baseline, 'baseline');
  requireOfficialResults(candidate, 'candidate');

  const baselineByCase = new Map(baseline.map((result) => [result.caseId, result]));
  const cases = candidate.map((candidateResult) => {
    const baselineResult = baselineByCase.get(candidateResult.caseId) ?? null;
    return compareCase(baselineResult, candidateResult);
  });

  return {
    cases,
    summary: summarize(cases),
  };
}

function compareCase(
  baseline: EvaluationResult | null,
  candidate: EvaluationResult
): CaseComparison {
  if (baseline === null) {
    return {
      caseId: candidate.caseId,
      baselineVariant: null,
      candidateVariant: candidate.variant,
      status: 'candidate-only',
      usefulnessDelta: null,
      baselineOutput: null,
      candidateOutput: candidate.output,
    };
  }

  const usefulnessDelta =
    baseline.manualScore === undefined || candidate.manualScore === undefined
      ? null
      : candidate.manualScore.usefulness - baseline.manualScore.usefulness;

  return {
    caseId: candidate.caseId,
    baselineVariant: baseline.variant,
    candidateVariant: candidate.variant,
    status: statusFromDelta(usefulnessDelta),
    usefulnessDelta,
    baselineOutput: baseline.output,
    candidateOutput: candidate.output,
  };
}

function statusFromDelta(delta: number | null): ComparisonStatus {
  if (delta === null || delta === 0) {
    return 'unchanged';
  }
  return delta > 0 ? 'improved' : 'regressed';
}

function summarize(cases: readonly CaseComparison[]): EvaluationComparisonSummary {
  return cases.reduce(
    (summary, item) => ({
      sharedCases: summary.sharedCases + (item.status === 'candidate-only' ? 0 : 1),
      improved: summary.improved + (item.status === 'improved' ? 1 : 0),
      regressed: summary.regressed + (item.status === 'regressed' ? 1 : 0),
      unchanged: summary.unchanged + (item.status === 'unchanged' ? 1 : 0),
      candidateOnly: summary.candidateOnly + (item.status === 'candidate-only' ? 1 : 0),
    }),
    {
      sharedCases: 0,
      improved: 0,
      regressed: 0,
      unchanged: 0,
      candidateOnly: 0,
    }
  );
}

function requireOfficialResults(results: readonly EvaluationResult[], label: string): void {
  const nonOfficial = results.find((result) => result.official !== true);
  if (nonOfficial !== undefined) {
    throw new Error(
      `QualityEvalCompare: ${label} result "${nonOfficial.caseId}" is not an official device result.`
    );
  }
}
