const EXTRACTION_SCHEMA =
  '{"subjectObject":"short scene summary","visibleObjects":["object label"],"visibleFeatures":["concrete visual feature"],"visibleText":["verbatim legible characters"],"visibleCondition":"visible state","uncertainty":["unclear detail"]}';

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
    'This one-time perception step records only what is directly visible in the attached image pixels.',
    'Do not speculate. Do not guess hidden details.',
    `Question context: ${sanitizePromptText(userQuestion)}`,
    'Return valid JSON only: one compact object without markdown.',
    'Use every schema key. Use [] when objects, text, features, or uncertainty are absent.',
    'visibleObjects contains object labels only. visibleText contains only characters actually readable in the pixels; never copy object labels into visibleText.',
    'Maximums: 12 objects, 12 features, 16 text spans, 8 uncertainty notes. Deduplicate items.',
    'Fields: subject/object, visible objects, visible features, visible text, visible condition, uncertainty.',
    'Schema:',
    EXTRACTION_SCHEMA,
  ].join('\n');
}

export function buildExtractionRetryPrompt(rawResponse: string, userQuestion: string): string {
  return [
    'Reformat the prior visible findings as one compact valid JSON object only.',
    `Question context: ${sanitizePromptText(userQuestion)}`,
    'Preserve facts exactly; add nothing. Use every schema key.',
    'Keep visibleObjects separate from verbatim OCR visibleText. Respect the array maximums.',
    'Fields: subject/object, visible objects, visible features, visible text, visible condition, uncertainty.',
    'Schema:',
    EXTRACTION_SCHEMA,
    'Prior findings:',
    sanitizePromptText(rawResponse),
  ].join('\n');
}

function sanitizePromptText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
