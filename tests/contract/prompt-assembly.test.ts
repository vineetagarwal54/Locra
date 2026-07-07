import { buildAnswerPrompt } from '../../src/inference/AnswerPrompt';
import { buildPinnedContextPrompt } from '../../src/inference/ContextBuilder';
import { buildStructuredExtractionPrompt } from '../../src/inference/ExtractionPrompt';
import { LOCRA_SYSTEM_PROMPT } from '../../src/inference/SystemPrompt';

const OFF_IMAGE_FOLLOW_UP = 'My pan is sticky, how do I fix it?';
const PINNED_EXTRACTION = [
  'Subject/object: cast-iron skillet',
  'Visible features: black, round, metal handle',
  'Visible text: None visible',
  'Visible condition: dull, patchy residue',
].join('\n');

describe('persistent system prompt', () => {
  it('establishes a concise grounded answer-first identity', () => {
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/you are locra/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/answer the user's actual question/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/visible evidence/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/general knowledge/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/concise/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/uncertaint/i);
  });

  it('drops the older expansive persona language', () => {
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/trusted friend/i);
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/match their energy/i);
  });
});

describe('benign off-image follow-up assembly', () => {
  const prompt = buildPinnedContextPrompt({
    pinnedExtraction: PINNED_EXTRACTION,
    turns: [{ question: 'What is this?', answer: PINNED_EXTRACTION }],
    question: OFF_IMAGE_FOLLOW_UP,
  });

  it('still invites general knowledge beyond the photo', () => {
    expect(prompt).toMatch(/draw freely on everything else you know/i);
  });

  it('still grounds visual facts in the pinned extraction', () => {
    expect(prompt).toContain(PINNED_EXTRACTION);
    expect(prompt).toContain(OFF_IMAGE_FOLLOW_UP);
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

    expect(prompt).toContain('Visible facts from the image');
    expect(prompt).toContain('General knowledge and reasoning');
    expect(prompt).toContain('Uncertainty');
    expect(prompt).toContain('Actionable next steps');
  });
});
