import { buildAnswerPrompt } from '../../src/inference/AnswerPrompt';
import {
  buildCanonicalModelMessages,
  createCanonicalConversationContext,
} from '../../src/inference/ContextBuilder';
import { buildStructuredExtractionPrompt } from '../../src/inference/ExtractionPrompt';
import { LOCRA_SYSTEM_PROMPT } from '../../src/inference/SystemPrompt';

const OFF_IMAGE_FOLLOW_UP = 'My pan is sticky, how do I fix it?';
describe('persistent system prompt', () => {
  it('establishes a short positive-first offline assistant identity', () => {
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/you are locra/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/helpful offline assistant/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/most useful answer/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/conversation context/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/available image evidence/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/practical steps/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/current value cannot be confirmed/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/uncertain/i);
  });

  it('drops the older expansive persona language', () => {
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/trusted friend/i);
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/match their energy/i);
  });
});

describe('canonical follow-up assembly', () => {
  const conversationContext = createCanonicalConversationContext([
      {
        question: 'What is this?',
        answer: 'It is a cast-iron skillet with dull, patchy residue.',
      },
    ]);
  const originalContext = JSON.parse(JSON.stringify(conversationContext));
  const messages = buildCanonicalModelMessages({
    conversationContext,
    currentQuestion: OFF_IMAGE_FOLLOW_UP,
  });

  it('keeps prior chat as separate canonical messages', () => {
    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
  });

  it('does not wrap follow-ups in a transcript prompt string', () => {
    expect(messages.at(-1)?.content).toBe(OFF_IMAGE_FOLLOW_UP);
    expect(messages.map((message) => message.content).join('\n')).not.toMatch(/conversation so far/i);
  });

  it('passes assembled context through unchanged while applying the effective mode config', () => {
    const lowModeMessages = buildCanonicalModelMessages({
      conversationContext,
      currentQuestion: OFF_IMAGE_FOLLOW_UP,
      responseMode: 'Low',
      responseModeConfig: {
        recentExactTurns: 6,
        contextBudgetUnits: 4_000,
        sameChatRetrievalLimit: 2,
        answerTargetTokens: 192,
        generationLimit: 320,
      },
    });

    expect(conversationContext).toEqual(originalContext);
    expect(lowModeMessages[0]?.content).toContain('192 tokens');
  });
});

describe('turn-1 extraction wrapper', () => {
  const prompt = buildStructuredExtractionPrompt('What is this?');

  it('keeps the visible-only rule scoped to the perception step', () => {
    expect(prompt).toMatch(/this step only|one-time perception/i);
    expect(prompt).toMatch(/only what is directly visible|state only what/i);
  });

  it('still keeps the no-speculation and JSON-only rules', () => {
    expect(prompt).toMatch(/do not speculate/i);
    expect(prompt).toMatch(/do not guess/i);
    expect(prompt).toMatch(/valid json only/i);
  });
});

describe('answer prompt assembly', () => {
  it('distinguishes visible facts from general knowledge and uncertainty', () => {
    const prompt = buildAnswerPrompt({
      question: 'How do I fix this?',
      hiddenEvidence: {
        version: 'hidden-evidence-v1',
        imagePath: '/photos/pan.jpg',
        sourceQuestion: 'How do I fix this?',
        subjectObject: 'worn cooking pan',
        visibleFeatures: ['dark cooking surface', 'scratched center'],
        visibleText: [],
        visibleCondition: 'surface appears worn in the center',
        uncertainty: ['coating material is not legible from the image'],
        createdAt: '2026-07-07T16:30:00.000Z',
      },
      conversationMode: 'live',
      generationConfigId: 'recommended-lfm2-vl-v1',
      pipelineVariantId: 'recommended-sampling-v1',
    });

    expect(prompt).toContain('Image evidence: worn cooking pan');
    expect(prompt).not.toContain('Visible facts from the image');
    expect(prompt).not.toContain('General knowledge and reasoning');
    expect(prompt).not.toContain('Actionable next steps');
  });
});
