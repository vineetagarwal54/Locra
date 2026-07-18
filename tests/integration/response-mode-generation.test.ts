import {
  buildCanonicalModelMessages,
  createCanonicalConversationContext,
} from '../../src/inference/ContextBuilder';
import {
  getResponseGenerationLimit,
  getResponseModeConfig,
  type ResponseMode,
} from '../../src/inference/ResponseMode';

describe('response mode generation assembly', () => {
  it('assembles different system instructions, context budgets, targets, and generation limits', () => {
    const prompt = 'Explain how a refrigerator works.';
    const modes: ResponseMode[] = ['Low', 'Medium', 'High'];
    const assembled = modes.map((responseMode) => {
      const config = getResponseModeConfig(responseMode);
      const messages = buildCanonicalModelMessages({
        conversationContext: createCanonicalConversationContext([]),
        currentQuestion: prompt,
        responseMode,
        responseModeConfig: config,
      });
      return {
        system: messages.find((message) => message.role === 'system')?.content,
        contextBudget: config.contextBudgetUnits,
        target: config.answerTargetTokens,
        limit: getResponseGenerationLimit(responseMode),
      };
    });

    expect(new Set(assembled.map((item) => item.system)).size).toBe(3);
    expect(assembled.map((item) => item.contextBudget)).toEqual([4000, 7000, 11000]);
    expect(assembled.map((item) => item.target)).toEqual([192, 384, 768]);
    expect(assembled.map((item) => item.limit)).toEqual([320, 640, 1024]);
  });
});
