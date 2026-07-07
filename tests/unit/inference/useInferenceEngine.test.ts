import { readFileSync } from 'fs';
import { join } from 'path';

describe('useInferenceEngine', () => {
  it('does not pass custom runtime sampling overrides to configure', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/useInferenceEngine.ts'),
      'utf8',
    );

    expect(source).toContain('current.configure({');
    expect(source).toContain('chatConfig');
    expect(source).not.toMatch(/generationConfig\s*:/);
    expect(source).not.toContain('LOCRA_GENERATION_CONFIG');
  });

  it('still configures the managed chat context and system prompt', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/useInferenceEngine.ts'),
      'utf8',
    );

    expect(source).toContain('LOCRA_SYSTEM_PROMPT');
    expect(source).toContain('SlidingWindowContextStrategy');
    expect(source).toContain('RESPONSE_TOKEN_BUDGET');
  });
});
