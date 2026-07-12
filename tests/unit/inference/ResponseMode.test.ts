import {
  DEFAULT_RESPONSE_MODE,
  getResponseModeInstruction,
  getResponseTokenBudget,
} from '../../../src/inference/ResponseMode';

describe('response modes', () => {
  it('defaults to Medium and owns all Qwen output budgets', () => {
    expect(DEFAULT_RESPONSE_MODE).toBe('Medium');
    expect(getResponseTokenBudget('Low')).toBe(192);
    expect(getResponseTokenBudget('Medium')).toBe(384);
    expect(getResponseTokenBudget('High')).toBe(768);
  });

  it.each(['Low', 'Medium', 'High'] as const)('asks %s responses to finish cleanly', (mode) => {
    expect(getResponseModeInstruction(mode)).toMatch(/finish the answer cleanly/i);
    expect(getResponseModeInstruction(mode)).toContain(String(getResponseTokenBudget(mode)));
  });
});
