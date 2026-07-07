const EXTRACTION_SCHEMA = `{
  "subjectObject": "short visible subject/object description",
  "visibleFeatures": ["visible color, shape, material, layout, or other concrete feature"],
  "visibleText": ["exact visible text, or an empty array"],
  "visibleCondition": "visible condition, pose, state, damage, freshness, or cleanliness"
}`;

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
    'JSON schema:',
    EXTRACTION_SCHEMA,
  ].join('\n');
}

export function buildExtractionRetryPrompt(rawResponse: string, userQuestion: string): string {
  return [
    'Your previous image extraction was not valid JSON.',
    `User question for context: ${sanitizePromptText(userQuestion)}`,
    'Rewrite the previous response as valid JSON only, preserving only visible facts.',
    'Required labeled findings: subject/object, visible features, visible text, visible condition.',
    'JSON schema:',
    EXTRACTION_SCHEMA,
    'Previous response:',
    sanitizePromptText(rawResponse),
  ].join('\n');
}

function sanitizePromptText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
