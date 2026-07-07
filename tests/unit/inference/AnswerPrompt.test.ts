import {
  buildAnswerPrompt,
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
  it('assembles visible-facts, general-knowledge, uncertainty, and actionable-step sections', () => {
    const prompt = buildAnswerPrompt(makeRequest());

    expect(prompt).toContain('Visible facts from the image');
    expect(prompt).toContain('General knowledge and reasoning');
    expect(prompt).toContain('Uncertainty');
    expect(prompt).toContain('Actionable next steps');
    expect(prompt).toContain('worn cooking pan');
    expect(prompt).toContain('scratched center');
  });

  it('starts normal practical questions with a direct answer instead of a raw list', () => {
    const prompt = buildAnswerPrompt(makeRequest('What should I do about this pan?'));

    expect(prompt).toMatch(/start with a direct answer/i);
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

    expect(prompt).toContain('User question:');
    expect(prompt).toContain('How do I fix this?');
    expect(prompt).toContain('Subject/object: worn cooking pan');
    expect(prompt).toContain('Visible condition: surface appears worn in the center');
    expect(prompt).toContain('coating material is not legible from the image');
  });
});
