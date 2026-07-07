import { readFileSync } from 'fs';
import { join } from 'path';

import { isEvaluationRecorderAvailable } from '../../src/evaluation/recorder/RecorderAvailability';

describe('evaluation isolation', () => {
  it('keeps the recorder unavailable in production builds', () => {
    expect(isEvaluationRecorderAvailable({ isDevBuild: false })).toBe(false);
    expect(isEvaluationRecorderAvailable({ isDevBuild: true })).toBe(true);
  });

  it('keeps production inference and store modules free of evaluation imports', () => {
    const productionFiles = [
      'src/inference/InferenceQueue.ts',
      'src/store/inferenceStore.ts',
      'src/history/HistoryStore.ts',
    ];

    for (const relativePath of productionFiles) {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
      expect(source).not.toMatch(/src\/evaluation|quality-eval|\.\.\/evaluation/);
    }
  });
});
