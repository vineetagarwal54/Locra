import type { ModelRequestMessage } from '../../../src/inference/ContextBuilder';
import {
  estimateMessageTokens,
  trimMessagesToContext,
} from '../../../src/inference/ContextWindow';
import {
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
    expect(estimated + getResponseTokenBudget('Low')).toBeLessThan(QWEN_CONTEXT_TOKEN_LIMIT);
  });
});
