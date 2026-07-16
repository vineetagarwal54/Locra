import type { ModelRequestMessage } from '../../../src/inference/ContextBuilder';
import {
  estimateMessageTokens,
  INPUT_SHORTENED_MARKER,
  trimMessagesToContext,
  trimMessagesToContextWithReport,
} from '../../../src/inference/ContextWindow';
import {
  getResponseGenerationLimit,
  getResponseTokenBudget,
  QWEN_CONTEXT_TOKEN_LIMIT,
} from '../../../src/inference/ResponseMode';

describe('Qwen context window trimming', () => {
  it('drops oldest turns while preserving recent turns and the current question', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: 'system' },
      ...Array.from({ length: 12 }, (_, index) => [
        { role: 'user' as const, content: `old question ${index} ${'x'.repeat(700)}` },
        { role: 'assistant' as const, content: `old answer ${index} ${'y'.repeat(700)}` },
      ]).flat(),
      { role: 'user', content: 'current question must remain' },
    ];

    const bounded = trimMessagesToContext(messages, 'High');

    expect(bounded.at(-1)?.content).toBe('current question must remain');
    expect(bounded.some((message) => message.content.startsWith('old question 11'))).toBe(true);
    expect(bounded.some((message) => message.content.startsWith('old question 0'))).toBe(false);
    const estimated = bounded.reduce((total, message) => total + estimateMessageTokens(message), 0);
    expect(estimated + getResponseTokenBudget('High')).toBeLessThan(QWEN_CONTEXT_TOKEN_LIMIT);
  });

  it('safely caps one oversized current question instead of overflowing the model input', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: '🙂'.repeat(50_000) },
    ];

    const bounded = trimMessagesToContext(messages, 'Low');
    const estimated = bounded.reduce((total, message) => total + estimateMessageTokens(message), 0);

    expect(bounded).toHaveLength(2);
    expect(bounded[1]?.content.length).toBeLessThan(messages[1].content.length);
    // The reserved output room is now the HARD generation limit, not the soft target.
    expect(estimated + getResponseGenerationLimit('Low')).toBeLessThan(QWEN_CONTEXT_TOKEN_LIMIT);
  });

  it('reserves the hard generation limit (not the soft target) as output room', () => {
    // A borderline-length message that fits under the soft-target reservation but
    // not under the hard-limit reservation must be shortened, proving the window
    // reserves the hard cap.
    const softButNotHard = QWEN_CONTEXT_TOKEN_LIMIT
      - getResponseTokenBudget('Low')
      - 200; // fits if only the soft target were reserved
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'a'.repeat(softButNotHard * 3) },
    ];

    const bounded = trimMessagesToContextWithReport(messages, 'Low');
    const estimated = bounded.messages.reduce(
      (total, message) => total + estimateMessageTokens(message),
      0,
    );
    expect(estimated + getResponseGenerationLimit('Low')).toBeLessThan(QWEN_CONTEXT_TOKEN_LIMIT);
    expect(bounded.inputShortenedWarning).not.toBeNull();
  });

  it('preserves the beginning AND end of an oversized message and warns clearly', () => {
    const head = 'BEGIN_MARKER the intent is stated up front. ';
    const tail = ' and finally the ACTUAL_QUESTION at the very end?';
    const filler = 'x'.repeat(60_000);
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: `${head}${filler}${tail}` },
    ];

    const bounded = trimMessagesToContextWithReport(messages, 'Low');
    const content = bounded.messages[1]?.content ?? '';

    // Both ends survive — the old behavior dropped the tail (the real question).
    expect(content.startsWith('BEGIN_MARKER')).toBe(true);
    expect(content).toContain('ACTUAL_QUESTION at the very end?');
    expect(content).toContain(INPUT_SHORTENED_MARKER.trim());
    expect(bounded.inputShortenedWarning).toMatch(/beginning and end/i);
  });

  it('never splits a surrogate pair at either preserved boundary', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: '😀'.repeat(40_000) },
    ];

    const content = trimMessagesToContext(messages, 'Low')[1]?.content ?? '';
    // A lone high/low surrogate would render as a replacement char; none should exist.
    expect(content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(content).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it('reports no warning when the input fits without shortening', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'a short question' },
    ];
    expect(trimMessagesToContextWithReport(messages, 'Low').inputShortenedWarning).toBeNull();
  });
});
