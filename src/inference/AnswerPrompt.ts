import type { HiddenVisualEvidence, UserFacingAnswerRequest } from './OutputPipelineTypes';

const VISIBLE_DETAIL_PATTERNS = [
  /\blist\b.*\bvisible\b.*\b(detail|feature|thing)s?\b/i,
  /\bwhat\b.*\bvisible\b.*\b(detail|feature|thing)s?\b/i,
  /\bdescribe\b.*\bvisible\b.*\b(detail|feature|thing)s?\b/i,
  /\bvisible details?\b/i,
];

export function wantsVisibleDetailList(question: string): boolean {
  const normalized = question.trim();
  if (normalized.length === 0) {
    return false;
  }

  return VISIBLE_DETAIL_PATTERNS.some(pattern => pattern.test(normalized));
}

export function buildAnswerPrompt(request: UserFacingAnswerRequest): string {
  return [
    buildInstructionSection(request.question),
    buildVisibleFactsSection(request.hiddenEvidence),
    buildGeneralKnowledgeSection(request.hiddenEvidence),
    buildUncertaintySection(request.hiddenEvidence),
    buildActionableNextStepsSection(request.hiddenEvidence),
    'User question:',
    request.question.trim(),
  ].join('\n\n');
}

function buildInstructionSection(question: string): string {
  if (wantsVisibleDetailList(question)) {
    return [
      'Answer as a short list of visible details.',
      'Keep the list grounded in what is actually visible.',
      'If a useful answer also needs a brief caveat about uncertainty, include it plainly.',
    ].join('\n');
  }

  return [
    'Start with a direct answer to the user question.',
    'Keep the answer grounded, concise, and practical.',
    'Use the sections below to separate visible facts from broader reasoning.',
  ].join('\n');
}

function buildVisibleFactsSection(hiddenEvidence: HiddenVisualEvidence | undefined): string {
  return ['Visible facts from the image', formatVisibleFacts(hiddenEvidence)].join('\n');
}

function buildGeneralKnowledgeSection(hiddenEvidence: HiddenVisualEvidence | undefined): string {
  return [
    'General knowledge and reasoning',
    hiddenEvidence === undefined
      ? '- Use only general knowledge needed to answer the question.'
      : `- Use these visible facts about ${hiddenEvidence.subjectObject} as grounding, then add any helpful real-world reasoning.`,
  ].join('\n');
}

function buildUncertaintySection(hiddenEvidence: HiddenVisualEvidence | undefined): string {
  return ['Uncertainty', formatUncertainty(hiddenEvidence)].join('\n');
}

function buildActionableNextStepsSection(hiddenEvidence: HiddenVisualEvidence | undefined): string {
  return [
    'Actionable next steps',
    hiddenEvidence === undefined
      ? '- Offer practical next steps only if they help answer the question.'
      : `- Give clear next steps that fit the visible condition: ${hiddenEvidence.visibleCondition}.`,
  ].join('\n');
}

function formatVisibleFacts(hiddenEvidence: HiddenVisualEvidence | undefined): string {
  if (hiddenEvidence === undefined) {
    return '- No extracted image evidence is available for this answer.';
  }

  return [
    `- Subject/object: ${hiddenEvidence.subjectObject}`,
    `- Visible features: ${formatList(hiddenEvidence.visibleFeatures)}`,
    `- Visible text: ${formatList(hiddenEvidence.visibleText)}`,
    `- Visible condition: ${hiddenEvidence.visibleCondition}`,
  ].join('\n');
}

function formatUncertainty(hiddenEvidence: HiddenVisualEvidence | undefined): string {
  if (hiddenEvidence === undefined || hiddenEvidence.uncertainty.length === 0) {
    return '- State uncertainty briefly when the image does not support a stronger claim.';
  }

  return hiddenEvidence.uncertainty.map(item => `- ${item}`).join('\n');
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return 'None visible';
  }

  return items.join(', ');
}
