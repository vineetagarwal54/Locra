import type {
  ContextMode,
  HiddenVisualEvidence,
  PipelineVariant,
  UserFacingAnswerRequest,
} from '../../../src/inference/OutputPipelineTypes';
import { CONTEXT_MODES } from '../../../src/inference/OutputPipelineTypes';

describe('OutputPipelineTypes', () => {
  it('defines the context modes needed by first-turn, live, and resumed answers', () => {
    const modes: ContextMode[] = ['live', 'resumeReconstruction', 'postReconstruction'];

    expect(CONTEXT_MODES).toEqual(modes);
  });

  it('models hidden visual evidence separately from the user-facing answer request', () => {
    const hiddenEvidence: HiddenVisualEvidence = {
      version: 'hidden-evidence-v1',
      imagePath: '/local/capture.jpg',
      sourceQuestion: 'How do I fix this?',
      subjectObject: 'worn cooking pan',
      visibleFeatures: ['dark cooking surface', 'scratched center'],
      visibleText: [],
      visibleCondition: 'surface appears worn in the center',
      uncertainty: ['coating material is not legible from the image'],
      createdAt: '2026-07-07T16:30:00.000Z',
    };
    const request: UserFacingAnswerRequest = {
      question: 'How do I fix this?',
      hiddenEvidence,
      conversationMode: 'live',
      generationConfigId: 'lfm2-vl-preset',
      pipelineVariantId: 'baseline-current',
    };

    expect(request.question).toBe(hiddenEvidence.sourceQuestion);
    expect(request.hiddenEvidence).toEqual(hiddenEvidence);
    expect(hiddenEvidence.visibleFeatures).toContain('scratched center');
  });

  it('models pipeline variants as stable identifiers plus version metadata', () => {
    const variant: PipelineVariant = {
      id: 'two-stage-v1',
      promptVersion: 'answer-prompt-v1',
      perceptionPromptVersion: 'hidden-evidence-v1',
      preprocessingVersion: 'preserve-document-v1',
      generationConfigId: 'recommended-lfm2-vl-v1',
      notes: 'Candidate two-stage output pipeline.',
    };

    expect(variant.id).toBe('two-stage-v1');
    expect(variant.generationConfigId).toBe('recommended-lfm2-vl-v1');
  });
});
