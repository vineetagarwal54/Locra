import { readFileSync } from 'fs';
import { join } from 'path';

import { buildShareText } from '../../../src/components/AnswerActions';

describe('buildShareText (FR-032)', () => {
  it('formats a question/answer pair as plain text', () => {
    expect(buildShareText('What is this?', 'A ceramic mug.')).toBe(
      'Q: What is this?\n\nA: A ceramic mug.'
    );
  });

  it('trims surrounding whitespace on both parts', () => {
    expect(buildShareText('  hi  ', '  there  ')).toBe('Q: hi\n\nA: there');
  });
});

describe('AnswerActions wiring (FR-031, FR-032)', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/AnswerActions.tsx'),
    'utf8'
  );

  it('copies to the clipboard via expo-clipboard with a confirmation (FR-031)', () => {
    expect(source).toContain("from 'expo-clipboard'");
    expect(source).toMatch(/setStringAsync\(answer\)/);
    // Haptic + visual confirmation.
    expect(source).toMatch(/haptics\.success/);
    expect(source).toMatch(/setCopied\(true\)/);
  });

  it('shares plain text via the built-in Share API, image-free and dependency-free (FR-032)', () => {
    expect(source).toMatch(/import \{[^}]*\bShare\b[^}]*\} from 'react-native'/);
    expect(source).toMatch(/Share\.share\(\{\s*message:/);
    // Plain text only — never the captured image.
    expect(source).not.toMatch(/imagePath|uri:/);
  });

  it('performs no navigation from either action (stays on the answer screen)', () => {
    expect(source).not.toMatch(/navigation\.|navigate\(/);
  });
});
