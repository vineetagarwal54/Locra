const EXTRACTION_SCHEMA = `{
  "subjectObject": "short visible subject/object description",
  "visibleFeatures": ["visible color, shape, material, layout, or other concrete feature"],
  "visibleText": ["exact visible text, or an empty array"],
  "visibleCondition": "visible condition, pose, state, damage, freshness, or cleanliness",
  "uncertainty": ["brief note for unclear, partial, or unreadable visual evidence"]
}`;

const STRUCTURED_VISION_PATTERNS = [
  /\b(ocr|transcribe|read|extract)\b.*\b(text|words?|numbers?|receipt|document|form)\b/i,
  /\b(text|code|serial|tracking|words?|numbers?)\b.*\b(label|document|form|receipt|image)\b/i,
  /\b(form|invoice|receipt|table|document)\b.*\b(fields?|values?|rows?|columns?|items?|total)\b/i,
  /\b(json|csv|schema|structured|key[- ]value)\b/i,
];

export function requiresStructuredVision(question: string): boolean {
  const normalized = question.trim();
  return normalized !== '' && STRUCTURED_VISION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function buildStructuredExtractionPrompt(userQuestion: string): string {
  return [
    'This is a one-time perception pass over the attached image. For THIS step only,',
    'record just what the pixels show. State only what is directly visible.',
    'Do not speculate and do not guess hidden details, and do not fold in outside',
    'knowledge yet (that comes freely in later turns). If it is not visible, leave it out.',
    `User question for context: ${sanitizePromptText(userQuestion)}`,
    'Return valid JSON only. Do not add markdown or commentary.',
    'Required labeled findings:',
    '- subject/object',
    '- visible features',
    '- visible text',
    '- visible condition',
    '- uncertainty',
    'JSON schema:',
    EXTRACTION_SCHEMA,
  ].join('\n');
}

export function buildExtractionRetryPrompt(rawResponse: string, userQuestion: string): string {
  return [
    'Your previous image extraction was not valid JSON.',
    `User question for context: ${sanitizePromptText(userQuestion)}`,
    'Rewrite the previous response as valid JSON only, preserving only visible facts.',
    'Required labeled findings: subject/object, visible features, visible text, visible condition, uncertainty.',
    'JSON schema:',
    EXTRACTION_SCHEMA,
    'Previous response:',
    sanitizePromptText(rawResponse),
  ].join('\n');
}

function sanitizePromptText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
