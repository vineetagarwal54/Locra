import {
  DEFAULT_RECENT_TURN_LIMIT,
  buildPinnedContextPrompt,
} from '../../../src/inference/ContextBuilder';

const pinnedExtraction =
  'Subject/object: black notebook\nVisible features: rectangular, matte cover';

describe('pinned context builder', () => {
  it('includes pinned extraction and the current follow-up question', () => {
    const prompt = buildPinnedContextPrompt({
      pinnedExtraction,
      turns: [{ question: 'What is visible?', answer: 'Subject/object: black notebook' }],
      question: 'What color is it?',
    });

    expect(prompt).toContain(pinnedExtraction);
    expect(prompt).toContain('What color is it?');
    expect(prompt).toContain('Conversation so far');
  });

  it('invites general knowledge instead of fencing the answer to the photo', () => {
    const prompt = buildPinnedContextPrompt({
      pinnedExtraction,
      turns: [],
      question: 'My pan is sticky, how do I fix it?',
    });

    expect(prompt).toMatch(/draw freely on everything else you know/i);
    expect(prompt).not.toMatch(/do not claim/i);
  });

  it('keeps pinned extraction when the verbatim turn window is exceeded', () => {
    const turns = Array.from({ length: DEFAULT_RECENT_TURN_LIMIT + 3 }, (_, index) => ({
      question: `Question ${index}`,
      answer: `Answer ${index}`,
    }));

    const prompt = buildPinnedContextPrompt({
      pinnedExtraction,
      turns,
      question: 'Use the visible facts.',
    });

    expect(prompt).toContain(pinnedExtraction);
    expect(prompt).toContain(`Question ${turns.length - 1}`);
    expect(prompt).not.toContain('Question 0');
  });
});
