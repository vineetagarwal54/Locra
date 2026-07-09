import { readFileSync } from 'fs';
import { join } from 'path';

describe('useInferenceEngine', () => {
  it('does not pass custom runtime sampling overrides or chat history config', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/useInferenceEngine.ts'),
      'utf8',
    );

    expect(source).not.toContain('configure({');
    expect(source).not.toContain('chatConfig');
    expect(source).not.toMatch(/generationConfig\s*:/);
    expect(source).not.toContain('LOCRA_GENERATION_CONFIG');
  });

  it('uses stateless generate and clears managed history defensively', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/useInferenceEngine.ts'),
      'utf8',
    );

    expect(source).toContain('generate(messages');
    expect(source).toContain('deleteMessage(0)');
    expect(source).not.toMatch(/sendMessage\(/);
  });
});
