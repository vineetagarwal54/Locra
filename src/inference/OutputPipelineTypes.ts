export const CONTEXT_MODES = [
  'live',
  'resumeReconstruction',
  'postReconstruction',
] as const;

export type ContextMode = (typeof CONTEXT_MODES)[number];

export interface HiddenVisualEvidence {
  version: string;
  imagePath: string;
  sourceQuestion: string;
  subjectObject: string;
  visibleFeatures: string[];
  visibleText: string[];
  visibleCondition: string;
  uncertainty: string[];
  createdAt: string;
}

export interface UserFacingAnswerRequest {
  question: string;
  hiddenEvidence?: HiddenVisualEvidence;
  conversationMode: ContextMode;
  generationConfigId: string;
  pipelineVariantId: string;
}

export interface PipelineVariant {
  id: string;
  promptVersion: string;
  perceptionPromptVersion: string;
  preprocessingVersion: string;
  generationConfigId: string;
  notes: string;
}
