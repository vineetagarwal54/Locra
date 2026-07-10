import {
  DEFAULT_RECENT_TURN_LIMIT,
  buildCanonicalModelMessages,
  buildCanonicalModelMessagesForConversation,
  buildImageAnswerModelMessages,
  buildPerceptionModelMessages,
  buildSingleUserModelMessages,
  getImageAttachmentPath,
  shouldRunPerceptionForMessage,
} from '../../../src/inference/ContextBuilder';
import type { ConversationMessage } from '../../../src/types/models';

function message(
  overrides: Partial<ConversationMessage> & Pick<ConversationMessage, 'id' | 'role'>
): ConversationMessage {
  return {
    text: '',
    attachments: [],
    status: 'completed',
    errorMessage: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

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

  it('detects an image-bearing user message at an arbitrary conversation position', () => {
    const messages: ConversationMessage[] = [
      message({ id: 'user-1', role: 'user', text: 'First text question' }),
      message({ id: 'assistant-1', role: 'assistant', text: 'First answer' }),
      message({
        id: 'user-2',
        role: 'user',
        text: 'Now inspect this image',
        attachments: [{ kind: 'image', path: '/photos/second-turn.jpg' }],
      }),
      message({ id: 'assistant-2', role: 'assistant', status: 'generating' }),
    ];

    expect(shouldRunPerceptionForMessage(messages[2])).toBe(true);
    expect(getImageAttachmentPath(messages[2])).toBe('/photos/second-turn.jpg');
    expect(shouldRunPerceptionForMessage(messages[0])).toBe(false);
    expect(getImageAttachmentPath(messages[0])).toBeNull();
  });

  it('builds a text-only follow-up over prior image-visible content without re-attaching media', () => {
    const messages: ConversationMessage[] = [
      message({
        id: 'user-image-a',
        role: 'user',
        text: 'What is in this photo?',
        attachments: [{ kind: 'image', path: '/photos/image-a.jpg' }],
      }),
      message({
        id: 'assistant-image-a',
        role: 'assistant',
        text: 'Image evidence: green watering can with a long spout.',
      }),
      message({ id: 'user-follow-up', role: 'user', text: 'What color was the spout?' }),
    ];

    const modelMessages = buildCanonicalModelMessagesForConversation({
      messages,
      currentUserMessageId: 'user-follow-up',
    });

    expect(modelMessages.some((item) => item.mediaPath !== undefined)).toBe(false);
    expect(modelMessages.map((item) => item.content)).toEqual(
      expect.arrayContaining([
        'What is in this photo?',
        'Image evidence: green watering can with a long spout.',
        'What color was the spout?',
      ]),
    );
  });

  it('preserves imageA text imageB text ordering as canonical model messages', () => {
    const messages: ConversationMessage[] = [
      message({
        id: 'user-image-a',
        role: 'user',
        text: 'Identify image A',
        attachments: [{ kind: 'image', path: '/photos/a.jpg' }],
      }),
      message({ id: 'assistant-image-a', role: 'assistant', text: 'Image A is an indoor mug.' }),
      message({ id: 'user-text', role: 'user', text: 'Is it clean?' }),
      message({ id: 'assistant-text', role: 'assistant', text: 'It appears clean.' }),
      message({
        id: 'user-image-b',
        role: 'user',
        text: 'Identify image B',
        attachments: [{ kind: 'image', path: '/photos/b.jpg' }],
      }),
      message({ id: 'assistant-image-b', role: 'assistant', text: 'Image B is an outdoor bicycle.' }),
      message({ id: 'user-final-text', role: 'user', text: 'Which one was outdoors?' }),
    ];

    const modelMessages = buildCanonicalModelMessagesForConversation({
      messages,
      currentUserMessageId: 'user-final-text',
    });

    expect(modelMessages.map((item) => item.content)).toEqual([
      expect.any(String),
      'Identify image A',
      'Image A is an indoor mug.',
      'Is it clean?',
      'It appears clean.',
      'Identify image B',
      'Image B is an outdoor bicycle.',
      'Which one was outdoors?',
    ]);
  });

  it('does not duplicate current image extraction beside the current message visible text', () => {
    const messages: ConversationMessage[] = [
      message({
        id: 'user-image',
        role: 'user',
        text: 'Image evidence: red bicycle near a garage.',
        attachments: [{ kind: 'image', path: '/photos/bike.jpg' }],
      }),
    ];

    const modelMessages = buildImageAnswerModelMessages({
      messages,
      currentUserMessageId: 'user-image',
      answerPrompt: 'Question: describe it.\nImage evidence: red bicycle near a garage.',
    });
    const joined = modelMessages.map((item) => item.content).join('\n');

    expect(joined.match(/Image evidence: red bicycle near a garage\./g)).toHaveLength(1);
    expect(modelMessages.some((item) => item.mediaPath !== undefined)).toBe(false);
  });
});
