import type { ModelRequestMessage } from '../../../src/inference/ContextBuilder';
import {
  buildToolRefusalRecoveryMessages,
  shouldRetryToolRefusal,
  TOOL_REFUSAL_RECOVERY_INSTRUCTION,
} from '../../../src/inference/ToolRefusalRecovery';

describe('ToolRefusalRecovery', () => {
  it.each([
    "I don't have the tool needed to answer that.",
    'I cannot access the required tool for this calculation.',
    'I need a tool to answer this question.',
    'Without access to a calculator, I cannot solve this.',
    'I’m unable to use the necessary calculator.',
    "This requires a tool that I don't have.",
  ])('detects a false tool refusal for a normal question: %s', (response) => {
    expect(shouldRetryToolRefusal(response, 'What is 17 times 24?')).toBe(true);
  });

  it('does not classify a normal direct answer as a refusal', () => {
    expect(shouldRetryToolRefusal('17 times 24 is 408.', 'What is 17 times 24?')).toBe(false);
  });

  it.each([
    ['What is the live weather in Boston right now?', 'I cannot access the required tool.'],
    ['Can you browse the web for the latest election results?', "I don't have a web browser."],
    ['Please open C:\\private\\report.pdf.', 'I cannot access the required tool.'],
    ['Can you turn off Wi-Fi on my phone?', 'I cannot access the required tool.'],
  ])('does not retry a genuine unavailable action: %s', (question, response) => {
    expect(shouldRetryToolRefusal(response, question)).toBe(false);
  });

  it.each([
    'How do I turn off Wi-Fi on my phone?',
    'Can you explain how to open a local file in TypeScript?',
  ])('still retries a false refusal for a normal how-to question: %s', (question) => {
    expect(shouldRetryToolRefusal('I cannot access the required tool.', question)).toBe(true);
  });

  it('adds the correction to the system instruction without duplicating conversation messages', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: 'System behavior.' },
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'What is 17 times 24?' },
    ];

    const recovered = buildToolRefusalRecoveryMessages(messages);

    expect(recovered).toHaveLength(messages.length);
    expect(recovered[0].content).toContain('System behavior.');
    expect(recovered[0].content).toContain(TOOL_REFUSAL_RECOVERY_INSTRUCTION);
    expect(recovered.slice(1)).toEqual(messages.slice(1));
  });

  it('uses a positive-first recovery instruction focused on answering usefully', () => {
    expect(TOOL_REFUSAL_RECOVERY_INSTRUCTION).toMatch(/unnecessarily unhelpful/i);
    expect(TOOL_REFUSAL_RECOVERY_INSTRUCTION).toMatch(/user's actual question/i);
    expect(TOOL_REFUSAL_RECOVERY_INSTRUCTION).toMatch(/knowledge, reasoning, and conversation context/i);
    expect(TOOL_REFUSAL_RECOVERY_INSTRUCTION).toMatch(/practical guidance directly/i);
    expect(TOOL_REFUSAL_RECOVERY_INSTRUCTION).toMatch(/most useful answer/i);
    expect(TOOL_REFUSAL_RECOVERY_INSTRUCTION).not.toMatch(/do not discuss tools/i);
  });
});
