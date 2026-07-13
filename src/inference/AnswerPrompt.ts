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
  const evidence = request.hiddenEvidence;
  return [
    buildInstructionText(request.question),
    `Question: ${request.question.trim()}`,
    evidence === undefined ? 'Image evidence: unavailable.' : formatCompactEvidence(evidence),
  ].join('\n\n');
}

function buildInstructionText(question: string): string {
  if (wantsVisibleDetailList(question)) {
    return [
      'Answer as a short list of visible details.',
      'Keep the list grounded in what is actually visible.',
      'If a useful answer also needs a brief caveat about uncertainty, include it plainly.',
    ].join('\n');
  }

  return [
    'Answer naturally and directly.',
    'Use the image evidence only as grounding for visual claims.',
    'Add brief uncertainty only when the evidence is unclear.',
    'Give practical next steps when they help.',
  ].join('\n');
}

function formatCompactEvidence(hiddenEvidence: HiddenVisualEvidence): string {
  return [
    `Image evidence: ${hiddenEvidence.subjectObject}.`,
    `Features: ${formatList(hiddenEvidence.visibleFeatures)}.`,
    `Readable text: ${formatList(hiddenEvidence.visibleText)}.`,
    `Condition: ${hiddenEvidence.visibleCondition}.`,
    hiddenEvidence.uncertainty.length === 0
      ? 'Unclear details: none noted.'
      : `Unclear details: ${hiddenEvidence.uncertainty.join('; ')}.`,
  ].join('\n');
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return 'None visible';
  }

  return items.join(', ');
}
