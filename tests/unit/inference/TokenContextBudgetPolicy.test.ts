import {
  ContextOrchestrator,
  createCanonicalConversationSnapshot,
  TokenContextBudgetPolicy,
} from '../../../src/inference/ContextOrchestrator';
import { getResponseModeConfig } from '../../../src/inference/ResponseMode';
import type { Conversation, ConversationMessage } from '../../../src/types/models';

function currentMessage(text: string): ConversationMessage {
  return {
    id: 'user-current',
    role: 'user',
    text,
    attachments: [],
    status: 'completed',
    errorMessage: null,
    createdAt: 1,
  };
}

function snapshot(text: string) {
  const message = currentMessage(text);
  const conversation: Conversation = {
    id: 'conversation-a',
    createdAt: 1,
    updatedAt: 1,
    messages: [message],
    status: 'completed',
    errorMessage: null,
    metrics: null,
    flagged: false,
    flagNote: null,
    contextMemory: null,
  };
  return createCanonicalConversationSnapshot(conversation, message.id);
}

describe('TokenContextBudgetPolicy', () => {
  it('uses the deterministic calibrated tier-1 estimate instead of character length', () => {
    const policy = new TokenContextBudgetPolicy();

    expect(policy.policyId).toBe('token-estimate-budget-v1');
    expect(policy.measure('abcdef')).toBe(2);
    expect(policy.measure('abcdef')).toBe(policy.measure('abcdef'));
    expect(policy.measure('abcdefghi')).toBeGreaterThan(policy.measure('abcdef'));
  });

  it('keeps recalibrated response-mode selected-context pools monotonic', () => {
    expect(getResponseModeConfig('Low').contextBudgetUnits)
      .toBeLessThan(getResponseModeConfig('Medium').contextBudgetUnits);
    expect(getResponseModeConfig('Medium').contextBudgetUnits)
      .toBeLessThan(getResponseModeConfig('High').contextBudgetUnits);
  });

  it.each(['Low', 'Medium', 'High'] as const)(
    'reports the effective token policy for %s mode',
    (mode) => {
      const result = new ContextOrchestrator().orchestrate(snapshot('Define entropy'), {
        responseMode: mode,
        diagnosticsEnabled: true,
      });

      expect(result.context.budget.policyId).toBe('token-estimate-budget-v1');
      expect(result.diagnostics?.budget.policyId).toBe('token-estimate-budget-v1');
    },
  );
});
