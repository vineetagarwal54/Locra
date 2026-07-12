import { readFileSync } from 'fs';
import { join } from 'path';

import { getStartupRuntimeSelection } from '../../../src/inference/StartupRuntimeSelection';

// Qwen through llama.rn is the only Locra V1 runtime. Startup selection is a
// fixed, process-locked constant — no runtime picker, no in-process switching,
// and no ExecuTorch fallback.

describe('startup runtime selection is Qwen-only V1', () => {
  it('always selects the Qwen host', () => {
    expect(getStartupRuntimeSelection().selectedHost).toBe('qwen-llamarn');
    expect(getStartupRuntimeSelection().source).toBe('default');
    expect(getStartupRuntimeSelection().processLocked).toBe(true);
  });

  it('returns a single immutable selection with no switching API', () => {
    expect(getStartupRuntimeSelection()).toBe(getStartupRuntimeSelection());

    const source = readFileSync(
      join(process.cwd(), 'src/inference/StartupRuntimeSelection.ts'),
      'utf8'
    );
    // No setter / picker / switcher, and no ExecuTorch runtime path.
    expect(source).not.toMatch(/set(Runtime|StartupRuntime|SelectedHost)/);
    expect(source).not.toMatch(/switchRuntime|runtimePicker/i);
    expect(source).not.toContain('executorch');
  });
});
