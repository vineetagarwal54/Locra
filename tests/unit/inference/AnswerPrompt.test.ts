import {
  buildAnswerPrompt,
  buildVisualGroundingPolicy,
  wantsVisibleDetailList,
} from '../../../src/inference/AnswerPrompt';
import type {
  HiddenVisualEvidence,
  UserFacingAnswerRequest,
} from '../../../src/inference/OutputPipelineTypes';

function makeHiddenEvidence(): HiddenVisualEvidence {
  return {
    version: 'hidden-evidence-v1',
    imagePath: '/photos/pan.jpg',
    sourceQuestion: 'How do I fix this?',
    subjectObject: 'worn cooking pan',
    visibleFeatures: ['dark cooking surface', 'scratched center'],
    visibleText: [],
    visibleCondition: 'surface appears worn in the center',
    uncertainty: ['coating material is not legible from the image'],
    createdAt: '2026-07-07T16:30:00.000Z',
  };
}

function makeRequest(question = 'How do I fix this?'): UserFacingAnswerRequest {
  return {
    question,
    hiddenEvidence: makeHiddenEvidence(),
    conversationMode: 'live',
    generationConfigId: 'recommended-lfm2-vl-v1',
    pipelineVariantId: 'recommended-sampling-v1',
  };
}

describe('AnswerPrompt', () => {
  it('assembles compact evidence without internal section scaffolding', () => {
    const prompt = buildAnswerPrompt(makeRequest());

    expect(prompt).toContain('Image evidence: worn cooking pan');
    expect(prompt).not.toContain('Visible facts from the image');
    expect(prompt).not.toContain('General knowledge and reasoning');
    expect(prompt).not.toContain('Actionable next steps');
    expect(prompt).toContain('worn cooking pan');
    expect(prompt).toContain('scratched center');
  });

  it('starts normal practical questions with a direct answer instead of a raw list', () => {
    const prompt = buildAnswerPrompt(makeRequest('What should I do about this pan?'));

    expect(prompt).toMatch(/answer naturally and directly/i);
    expect(prompt).not.toMatch(/answer as a short list of visible details/i);
  });

  it('allows list-style output when the user explicitly asks for visible details', () => {
    const question = 'List the visible details in this image.';
    const prompt = buildAnswerPrompt(makeRequest(question));

    expect(wantsVisibleDetailList(question)).toBe(true);
    expect(prompt).toMatch(/answer as a short list of visible details/i);
  });

  it('assembles the final first-turn answer prompt from the original question plus hidden evidence', () => {
    const prompt = buildAnswerPrompt(makeRequest('How do I fix this?'));

    expect(prompt).toContain('Question:');
    expect(prompt).toContain('How do I fix this?');
    expect(prompt).toContain('Image evidence: worn cooking pan');
    expect(prompt).toContain('Condition: surface appears worn in the center');
    expect(prompt).toContain('coating material is not legible from the image');
  });

  it.each([
    'Transcribe every readable line in the screenshot.',
    'List the exact serial numbers shown on the labels.',
    'How many objects are visible in the photo?',
  ])('applies reusable exact-evidence discipline for "%s"', (question) => {
    const policy = buildVisualGroundingPolicy(question);
    expect(policy).toMatch(/only clearly supported values/i);
    expect(policy).toMatch(/nearby object/i);
    expect(policy).toMatch(/cannot be confirmed/i);
    expect(policy).toMatch(/do not guess/i);
  });

  it('does not add exact-value extraction policy to general advice', () => {
    expect(buildVisualGroundingPolicy('How should I maintain this pan?')).toBe('');
  });
});
