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
});
