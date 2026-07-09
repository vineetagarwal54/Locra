import {
  DEFAULT_RECENT_TURN_LIMIT,
  buildCanonicalModelMessages,
  buildPerceptionModelMessages,
  buildSingleUserModelMessages,
} from '../../../src/inference/ContextBuilder';

describe('ContextBuilder', () => {
  it('builds live follow-up context as explicit canonical messages', () => {
    const messages = buildCanonicalModelMessages({
      turns: [{ question: 'What is visible?', answer: 'It is a black notebook.' }],
      currentQuestion: 'shorter',
    });

    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(messages.at(-1)?.content).toBe('shorter');
    expect(messages.map((message) => message.content).join('\n')).not.toContain(
      'Conversation so far'
    );
  });

  it('keeps canonical turns as separate messages instead of a transcript prompt', () => {
    const messages = buildCanonicalModelMessages({
      turns: [
        { question: 'What is this?', answer: 'It is a pan.' },
        { question: 'Is it safe?', answer: 'The coating looks worn.' },
      ],
      currentQuestion: 'Then help me',
    });

    expect(messages[1]).toEqual({ role: 'user', content: 'What is this?' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'It is a pan.' });
    expect(messages[3]).toEqual({ role: 'user', content: 'Is it safe?' });
    expect(messages[4]).toEqual({ role: 'assistant', content: 'The coating looks worn.' });
    expect(messages[5]).toEqual({ role: 'user', content: 'Then help me' });
  });

  it('bounds recent canonical turns deterministically', () => {
    const turns = Array.from({ length: DEFAULT_RECENT_TURN_LIMIT + 3 }, (_, index) => ({
      question: `Question ${index}`,
      answer: `Answer ${index}`,
    }));

    const messages = buildCanonicalModelMessages({
      turns,
      currentQuestion: 'Use the visible facts.',
    });
    const content = messages.map((message) => message.content).join('\n');

    expect(content).toContain(`Question ${turns.length - 1}`);
    expect(content).not.toContain('Question 0');
  });

  it('attaches image media only to isolated perception requests', () => {
    const messages = buildPerceptionModelMessages('Return JSON only.', '/photo.jpg');

    expect(messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'Return JSON only.', mediaPath: '/photo.jpg' },
    ]);
  });

  it('builds single-user final answer requests without canonical transcript turns', () => {
    const messages = buildSingleUserModelMessages('Question: what is this?');

    expect(messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'Question: what is this?' },
    ]);
  });
});
