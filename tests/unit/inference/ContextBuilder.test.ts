import {
  buildCanonicalModelMessages as buildCanonicalModelMessagesFromContext,
  buildCanonicalModelMessagesForConversation,
  buildImageAnswerModelMessages,
  buildPerceptionModelMessages,
  buildSingleUserModelMessages,
  createCanonicalConversationContext,
  getImageAttachmentPath,
  shouldRunPerceptionForMessage,
  type ContextTurn,
  type ModelRequestMessage,
} from '../../../src/inference/ContextBuilder';
import type { ConversationMessage } from '../../../src/types/models';
import type { CanonicalConversationContext } from '../../../src/types/models';

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

function buildCanonicalModelMessages(input: {
  turns: ReadonlyArray<ContextTurn>;
  currentQuestion: string;
}): ModelRequestMessage[] {
  return buildCanonicalModelMessagesFromContext({
    conversationContext: createCanonicalConversationContext(input.turns),
    currentQuestion: input.currentQuestion,
  });
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
    expect(messages[0]?.content).toMatch(/final user message is the current request/i);
    expect(messages[0]?.content).toMatch(/resolve references/i);
    expect(messages[0]?.content).toMatch(/fixed source material/i);
    expect(messages[0]?.content).toMatch(/do not repeat or recycle/i);
    expect(messages.map((message) => message.content).join('\n')).not.toContain(
      'Conversation so far'
    );
  });

  it('does not add follow-up-only instructions to a first-turn request', () => {
    const messages = buildCanonicalModelMessages({
      turns: [],
      currentQuestion: 'Explain dependency injection.',
    });

    expect(messages[0]?.content).not.toMatch(/final user message is the current request/i);
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: 'Explain dependency injection.',
    });
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

  it('serializes selected evidence, facts, and summary without changing exact turns', () => {
    const conversationContext: CanonicalConversationContext = {
      version: 'canonical-conversation-v2',
      recentTurns: [{ question: 'Recent question', answer: 'Recent answer' }],
      mediaEvidence: [
        {
          version: 'context-media-evidence-v1',
          id: 'user-image:image',
          sourceMessageId: 'user-image',
          modality: 'image',
          sourcePath: '/images/board.jpg',
          summary: 'planning whiteboard',
          facts: ['three project milestones'],
          extractedText: ['Launch Friday'],
          uncertainty: [],
          createdAt: 10,
        },
      ],
      importantFacts: [
        {
          version: 'context-memory-fact-v1',
          id: 'assistant-old:fact:0',
          sourceMessageId: 'assistant-old',
          text: 'The release decision was Friday.',
          createdAt: 5,
        },
      ],
      olderSummary: 'User: Plan the release.\nLocra: The first draft was approved.',
      budget: {
        policyId: 'character-budget-v1',
        maximumUnits: 14_400,
        usedUnits: 500,
      },
    };

    const messages = buildCanonicalModelMessagesFromContext({
      conversationContext,
      currentQuestion: 'What should happen next?',
    });
    const systemContent = messages[0]?.content ?? '';

    expect(systemContent.indexOf('Relevant prior media evidence')).toBeLessThan(
      systemContent.indexOf('Important prior facts and decisions'),
    );
    expect(systemContent.indexOf('Important prior facts and decisions')).toBeLessThan(
      systemContent.indexOf('Older conversation summary'),
    );
    expect(systemContent).toContain('Launch Friday');
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'Recent question' },
      { role: 'assistant', content: 'Recent answer' },
      { role: 'user', content: 'What should happen next?' },
    ]);
  });

  it('keeps a previous assistant offer intact for an acknowledgement follow-up', () => {
    const explanation = 'Background detail. '.repeat(90);
    const offer = 'I can also turn this into a three-step checklist.';
    const messages = buildCanonicalModelMessages({
      turns: [
        {
          question: 'How should I organize this project?',
          answer: `${explanation}${offer}`,
        },
      ],
      currentQuestion: 'Yes',
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'How should I organize this project?' },
      { role: 'assistant', content: `${explanation}${offer}` },
      { role: 'user', content: 'Yes' },
    ]);
  });

  it('retains an earlier numbered item while a conversation continues', () => {
    const turns = [
      {
        question: 'Here are the questions I need to resolve.',
        answer: '1. Choose a database.\n2. Define the offline sync policy.\n3. Plan backups.',
      },
      ...Array.from({ length: 7 }, (_, index) => ({
        question: `Related discussion ${index + 1}`,
        answer: `Related answer ${index + 1}`,
      })),
    ];

    const messages = buildCanonicalModelMessages({
      turns,
      currentQuestion: 'Please handle the second item next.',
    });

    expect(messages.map((item) => item.content)).toEqual(
      expect.arrayContaining([
        'Here are the questions I need to resolve.',
        '1. Choose a database.\n2. Define the offline sync policy.\n3. Plan backups.',
      ]),
    );
  });

  it('preserves pronoun antecedents in chronological role order', () => {
    const messages = buildCanonicalModelMessages({
      turns: [
        {
          question: 'I am comparing SQLite and MMKV for settings.',
          answer: 'MMKV is the simpler fit for small key-value settings.',
        },
        {
          question: 'What is its main tradeoff?',
          answer: 'It is not a relational query engine.',
        },
      ],
      currentQuestion: 'Would it still work offline?',
    });

    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'I am comparing SQLite and MMKV for settings.' },
      { role: 'assistant', content: 'MMKV is the simpler fit for small key-value settings.' },
      { role: 'user', content: 'What is its main tradeoff?' },
      { role: 'assistant', content: 'It is not a relational query engine.' },
      { role: 'user', content: 'Would it still work offline?' },
    ]);
  });

  it('retains the originating topic after several short turns', () => {
    const turns = [
      {
        question: 'Let us plan a balcony herb garden.',
        answer: 'Start with basil, mint, and thyme.',
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        question: `Planning detail ${index + 1}`,
        answer: `Decision ${index + 1}`,
      })),
    ];

    const messages = buildCanonicalModelMessages({
      turns,
      currentQuestion: 'What should we do next?',
    });

    expect(messages.map((item) => item.content)).toEqual(
      expect.arrayContaining([
        'Let us plan a balcony herb garden.',
        'Start with basil, mint, and thyme.',
      ]),
    );
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
    expect(modelMessages[0]?.content).toMatch(/final user message is the current request/i);
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

  it('applies the same follow-up focus to an image answer with prior canonical turns', () => {
    const messages: ConversationMessage[] = [
      message({ id: 'user-1', role: 'user', text: 'Compare two repair approaches.' }),
      message({
        id: 'assistant-1',
        role: 'assistant',
        text: 'Approach A replaces the part. Approach B repairs it in place.',
      }),
      message({
        id: 'user-image',
        role: 'user',
        text: 'Which approach fits this image?',
        attachments: [{ kind: 'image', path: '/photos/repair.jpg' }],
      }),
    ];

    const modelMessages = buildImageAnswerModelMessages({
      messages,
      currentUserMessageId: 'user-image',
      answerPrompt: 'Question: Which approach fits this image?\nImage evidence: cracked part.',
    });

    expect(modelMessages[0]?.content).toMatch(/final user message is the current request/i);
    expect(modelMessages.slice(1, 3)).toEqual([
      { role: 'user', content: 'Compare two repair approaches.' },
      {
        role: 'assistant',
        content: 'Approach A replaces the part. Approach B repairs it in place.',
      },
    ]);
  });
});
