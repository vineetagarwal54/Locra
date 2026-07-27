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
  const groundingPolicy = buildVisualGroundingPolicy(request.question);
  return [
    buildInstructionText(request.question),
    groundingPolicy,
    `Question: ${request.question.trim()}`,
    evidence === undefined ? 'Image evidence: unavailable.' : formatCompactEvidence(evidence),
  ].filter((section) => section !== '').join('\n\n');
}

export function buildVisualGroundingPolicy(question: string): string {
  if (
    !/\b(?:read|transcribe|extract|price|cost|total|count|how many|date|serial|code|label|number|text|exact|color|colour)\b/i
      .test(question)
  ) {
    return '';
  }
  return [
    'Exact visual evidence policy:',
    '- Report only clearly supported values and attributes.',
    '- Associate each value or label with the correct nearby object.',
    '- Do not transfer values between objects or infer equality from proximity or similarity.',
    '- Mark details as confirmed, uncertain, or unreadable.',
    '- If a requested value cannot be confirmed, say so; do not guess.',
    '- Stay focused on the requested extraction and omit unrelated generic advice.',
  ].join('\n');
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
    'For counts or object identification, distinguish confirmed details from uncertain ones.',
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
