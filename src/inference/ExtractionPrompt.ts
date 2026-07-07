const EXTRACTION_SCHEMA = `{
  "subjectObject": "short visible subject/object description",
  "visibleFeatures": ["visible color, shape, material, layout, or other concrete feature"],
  "visibleText": ["exact visible text, or an empty array"],
  "visibleCondition": "visible condition, pose, state, damage, freshness, or cleanliness"
}`;

export function buildStructuredExtractionPrompt(userQuestion: string): string {
  return [
    'Inspect the attached image and extract only facts that are directly visible.',
    `User question for context: ${sanitizePromptText(userQuestion)}`,
    'Return valid JSON only. Do not add markdown, commentary, or speculation.',
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
