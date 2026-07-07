import { readFileSync } from 'fs';
import { join } from 'path';

import {
  EVALUATION_CATEGORIES,
  summarizeCaseSet,
  validateEvaluationCaseSet,
} from '../../../src/evaluation/QualityEvalSchemas';

const caseSetPath = join(process.cwd(), 'quality-eval/cases/cases.v1.json');

describe('quality-eval fixed case set', () => {
  const cases = JSON.parse(readFileSync(caseSetPath, 'utf8')) as unknown[];

  it('is valid against the evaluation case schema', () => {
    const result = validateEvaluationCaseSet(cases);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('contains at least three cases for every required category', () => {
    const summary = summarizeCaseSet(cases);

    for (const category of EVALUATION_CATEGORIES) {
      expect(summary.categoryCounts[category]).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses repo-tracked image assets for at least eighty percent of cases', () => {
    const summary = summarizeCaseSet(cases);

    expect(summary.totalCases).toBeGreaterThanOrEqual(18);
    expect(summary.repoAssetRatio).toBeGreaterThanOrEqual(0.8);
  });
});
