import {
  assessAnswerQuality,
  postProcessAnswer,
} from '../../../src/inference/AnswerPostProcessor';

describe('AnswerPostProcessor (FR-054)', () => {
  it('trims leading and trailing whitespace', () => {
    const result = postProcessAnswer('  The mug is blue.  \n');

    expect(result.text).toBe('The mug is blue.');
    expect(result.verdict).toBe('complete');
  });

  it('marks a normal complete answer as complete', () => {
    expect(postProcessAnswer('The mug is blue.').verdict).toBe('complete');
    expect(postProcessAnswer('Is it open? Yes!').verdict).toBe('complete');
    expect(postProcessAnswer('It says "Fragile."').verdict).toBe('complete');
    expect(postProcessAnswer('Three items: a pen, a cup, a plant.').verdict).toBe('complete');
  });

  it.each([
    'Here is the answer.\n- First item.\n- Second item.',
    'Steps:\n1. Open settings.\n2. Select Downloads.\n3. Restart the app.',
    'First sentence.  Second sentence.\nThird sentence.',
  ])('preserves normal internal formatting exactly', (formatted) => {
    expect(postProcessAnswer(formatted)).toEqual({
      text: formatted,
      verdict: 'complete',
    });
  });

  it('flags an answer that stops mid-sentence as truncated', () => {
    expect(postProcessAnswer('The mug is blue and the handle').verdict).toBe('truncated');
    expect(postProcessAnswer('It contains a list of').verdict).toBe('truncated');
  });

  it('flags an answer with an immediately repeated tail phrase as looping', () => {
    const looping =
      'The label says fresh milk. The label says fresh milk. The label says fresh milk.';

    expect(postProcessAnswer(looping).verdict).toBe('looping');
  });

  it('collapses the repeated tail so the visible answer reads once', () => {
    const looping =
      'It is a red bicycle. It is a red bicycle. It is a red bicycle. It is a red bicycle.';

    const result = postProcessAnswer(looping);

    expect(result.verdict).toBe('looping');
    expect(result.text).toBe('It is a red bicycle.');
  });

  it('does not flag legitimate repetition that is not a trailing loop', () => {
    const legitimate = 'There are two signs. One says stop. The other also says stop.';

    expect(postProcessAnswer(legitimate).verdict).toBe('complete');
  });

  it('treats an empty answer as complete (error paths own the empty case)', () => {
    expect(postProcessAnswer('').verdict).toBe('complete');
    expect(postProcessAnswer('   ').text).toBe('');
  });

  it('assessAnswerQuality is a pure read usable on persisted history answers', () => {
    expect(assessAnswerQuality('The mug is blue.')).toBe('complete');
    expect(assessAnswerQuality('The mug is blue and the')).toBe('truncated');
  });

  it('does not remove two consecutive repeated sentences', () => {
    const repeated =
      'Water boils at 100 degrees Celsius. Water boils at 100 degrees Celsius. It does so at sea level.';

    expect(postProcessAnswer(repeated)).toEqual({
      text: repeated,
      verdict: 'complete',
    });
  });

  it('does not remove two consecutive repeated paragraphs', () => {
    const repeated = 'Here is the summary.\n\nHere is the summary.\n\nThat is all.';

    expect(postProcessAnswer(repeated)).toEqual({
      text: repeated,
      verdict: 'complete',
    });
  });

  it('collapses three consecutive repeated sentences and preserves the first exactly', () => {
    const repeated =
      'Keep  this formatting. Keep this formatting. Keep this formatting. Then continue.';

    expect(postProcessAnswer(repeated)).toEqual({
      text: 'Keep  this formatting. Then continue.',
      verdict: 'looping',
    });
  });

  it('collapses three consecutive repeated paragraphs and preserves the first exactly', () => {
    const repeated =
      '  Keep  this paragraph.\n\n' +
      'Keep this paragraph.\n\n' +
      'Keep this paragraph.\n\nThat is all.';

    expect(postProcessAnswer(repeated)).toEqual({
      text: 'Keep  this paragraph.\n\nThat is all.',
      verdict: 'looping',
    });
  });

  it('does not remove non-consecutive repeated sentences', () => {
    const spaced = 'Turn it off. Then wait a moment. Turn it off.';

    const result = postProcessAnswer(spaced);

    expect(result.text).toBe(spaced);
    expect(result.verdict).toBe('complete');
  });

  it('preserves repeated lines inside a fenced code block', () => {
    const code =
      '# Example\n\n> Keep the quoted text.\n\n```\nretry()\nretry()\nretry()\n```\n\nDone.';

    const result = postProcessAnswer(code);

    expect(result).toEqual({ text: code, verdict: 'complete' });
  });

  it('trims a three-sentence cycle repeated three times to its first occurrence', () => {
    const cycle = [
      'The laptop is open.',
      'Its screen shows a dark editor.',
      'It sits on a wooden desk.',
    ].join(' ');
    const result = postProcessAnswer(`The image shows a workspace. ${cycle} ${cycle} ${cycle}`);

    expect(result).toEqual({
      text: `The image shows a workspace. ${cycle}`,
      verdict: 'looping',
    });
  });

  it('does not modify legitimate nonconsecutive repeated prose blocks', () => {
    const prose =
      'Turn it off. Wait ten seconds. Check the cable. Turn it off. Wait ten seconds. ' +
      'Then inspect the outlet before trying again.';

    expect(postProcessAnswer(prose)).toEqual({ text: prose, verdict: 'complete' });
  });
});
