import type { ModelRequestMessage } from '../../../src/inference/ContextBuilder';
import {
  CONTEXT_SAFETY_TOKENS,
  estimateMessageTokens,
  getContextCapacityBuckets,
  INPUT_SHORTENED_MARKER,
  MAX_NATIVE_RECONCILIATION_PASSES,
  NativePromptLimitError,
  reconcileMessagesToNativeTokenCount,
  reconcileMessagesWithNativeTokenizer,
  trimMessagesToContext,
  trimMessagesToContextWithReport,
} from '../../../src/inference/ContextWindow';
import {
  getResponseGenerationLimit,
  getResponseModeConfig,
  getResponseTokenBudget,
  QWEN_CONTEXT_TOKEN_LIMIT,
} from '../../../src/inference/ResponseMode';

describe('Qwen context window trimming', () => {
  it.each(['Low', 'Medium', 'High'] as const)(
    'keeps all five capacity buckets within the model window in %s mode',
    (mode) => {
      const buckets = getContextCapacityBuckets(
        mode,
        'current input',
        true,
        getResponseModeConfig(mode).contextBudgetUnits,
      );
      const reserved =
        buckets.systemInstructions +
        buckets.currentInput +
        buckets.imageInput +
        buckets.selectedContext +
        buckets.generatedOutput;

      expect(reserved).toBeLessThanOrEqual(QWEN_CONTEXT_TOKEN_LIMIT - CONTEXT_SAFETY_TOKENS);
    },
  );

  it('reconciles an over-limit native count without evicting system or current input', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: 'system instructions' },
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'newer question' },
      { role: 'assistant', content: 'newer answer' },
      { role: 'user', content: 'current request' },
    ];

    const reconciled = reconcileMessagesToNativeTokenCount(messages, 'Low', 5_000);

    expect(reconciled[0]).toEqual(messages[0]);
    expect(reconciled.at(-1)).toEqual(messages.at(-1));
    expect(reconciled.length).toBeLessThan(messages.length);
  });

  it('remeasures after history removal and accepts the verified second prompt', async () => {
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: 'system instructions' },
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'current request' },
    ];
    const measure = jest.fn()
      .mockResolvedValueOnce(5_000)
      .mockResolvedValueOnce(1_000);

    const result = await reconcileMessagesWithNativeTokenizer(messages, 'Low', measure);

    expect(measure).toHaveBeenCalledTimes(2);
    expect(result.messages).toEqual([
      messages[0],
      messages[3],
    ]);
    expect(result.finalNativePromptTokens).toBe(1_000);
  });

  it.each([
    ['token-dense text', 'ZX_418::'.repeat(2_000)],
    ['non-English text', 'école 日本語 مرحبا '.repeat(1_000)],
    ['code-heavy input', 'const value = map.get(key) ?? fallback;\n'.repeat(1_000)],
  ])('shortens measured %s while preserving its beginning and end', async (_label, content) => {
    const first = content.slice(0, 1);
    const last = content.slice(-1);
    const measure = jest.fn(async (candidate: ReadonlyArray<ModelRequestMessage>) =>
      candidate.at(-1)?.content.includes(INPUT_SHORTENED_MARKER.trim()) === true
        ? 1_000
        : 8_000,
    );

    const result = await reconcileMessagesWithNativeTokenizer([
      { role: 'system', content: 'system' },
      { role: 'user', content },
    ], 'Low', measure);
    const shortened = result.messages.at(-1)?.content ?? '';

    expect(shortened.startsWith(first)).toBe(true);
    expect(shortened.endsWith(last)).toBe(true);
    expect(shortened).toContain(INPUT_SHORTENED_MARKER.trim());
    expect(result.currentInputShortened).toBe(true);
  });

  it('shortens the current question when system plus current input exceeds the native limit', async () => {
    const question = `BEGIN ${'dense '.repeat(2_000)} END?`;
    const measure = jest.fn(async (candidate: ReadonlyArray<ModelRequestMessage>) =>
      candidate.at(-1)?.content.includes(INPUT_SHORTENED_MARKER.trim()) === true
        ? 2_000
        : 6_000,
    );

    const result = await reconcileMessagesWithNativeTokenizer([
      { role: 'system', content: 'fixed system instructions' },
      { role: 'user', content: question },
    ], 'Medium', measure);

    expect(result.messages[0]?.content).toBe('fixed system instructions');
    expect(result.messages.at(-1)?.content).toMatch(/^B.*END\?$/s);
    expect(result.currentInputShortened).toBe(true);
  });

  it('preserves an explicitly referenced image media path through reconciliation', async () => {
    const seenPaths: Array<string | undefined> = [];
    const measure = jest.fn(async (candidate: ReadonlyArray<ModelRequestMessage>) => {
      seenPaths.push(candidate.at(-1)?.mediaPath);
      return candidate.length > 2 ? 5_000 : 1_000;
    });
    const result = await reconcileMessagesWithNativeTokenizer([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'old context' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'read this image', mediaPath: '/image.jpg' },
    ], 'Low', measure);

    expect(seenPaths).toEqual(['/image.jpg', '/image.jpg']);
    expect(result.messages.at(-1)?.mediaPath).toBe('/image.jpg');
  });

  it('terminates within the explicit pass bound instead of calling completion over limit', async () => {
    const measure = jest.fn(async () => 20_000);

    await expect(reconcileMessagesWithNativeTokenizer([
      { role: 'system', content: 'system'.repeat(3_000) },
      { role: 'user', content: 'question' },
    ], 'Low', measure)).rejects.toBeInstanceOf(NativePromptLimitError);
    expect(measure.mock.calls.length).toBeLessThanOrEqual(MAX_NATIVE_RECONCILIATION_PASSES);
  });
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
