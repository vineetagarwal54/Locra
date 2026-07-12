import { readFileSync } from 'fs';
import { join } from 'path';

import { getStartupRuntimeSelection } from '../../../src/inference/StartupRuntimeSelection';

// Qwen is the only Locra V1 runtime host. The parent host mounts exactly one
// Qwen host and calls Qwen hooks only inside the Qwen host component; there is no
// runtime picker or in-process switching.

describe('inference engine host selection (Qwen-only)', () => {
  it('locks a single Qwen host selection at module startup', () => {
    expect(getStartupRuntimeSelection().selectedHost).toBe('qwen-llamarn');
    expect(getStartupRuntimeSelection()).toBe(getStartupRuntimeSelection());
  });

  it('mounts exactly one Qwen host and no ExecuTorch host', () => {
    const parentSource = readFileSync(
      join(process.cwd(), 'src/components/InferenceEngineHost.tsx'),
      'utf8',
    );

    expect(parentSource.match(/<QwenInferenceEngineHost\b/g)).toHaveLength(1);
    expect(parentSource).not.toContain('ExecutorchInferenceEngineHost');
    expect(parentSource).not.toContain('useExecutorchInferenceEngine(');
  });

  it('keeps the Qwen hook isolated inside the Qwen host component', () => {
    const qwenHostSource = readFileSync(
      join(process.cwd(), 'src/components/QwenInferenceEngineHost.tsx'),
      'utf8',
    );
    expect(qwenHostSource).toContain('useQwenInferenceEngine(');
  });
});
