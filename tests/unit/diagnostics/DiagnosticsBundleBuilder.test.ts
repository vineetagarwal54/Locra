import {
  buildDiagnosticsBundleJson,
  buildDiagnosticsMarkdown,
  type AppDiagnosticsInfo,
} from '../../../src/diagnostics/DiagnosticsBundleBuilder';
import type { DiagnosticTurnRecord } from '../../../src/diagnostics/DiagnosticsTraceStore';
import type { Conversation } from '../../../src/types/models';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-a',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
    messages: [
      {
        id: 'user-1',
        role: 'user',
        text: 'What is in this photo?',
        attachments: [{ kind: 'image', path: '/tmp/photo.jpg' }],
        status: 'completed',
        errorMessage: null,
        createdAt: 1_700_000_000_000,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        text: 'A wooden chair.',
        attachments: [],
        status: 'completed',
        errorMessage: null,
        createdAt: 1_700_000_000_050,
      },
    ],
    status: 'completed',
    errorMessage: null,
    metrics: null,
    flagged: false,
    flagNote: null,
    ...overrides,
  };
}

function makeTurn(overrides: Partial<DiagnosticTurnRecord> = {}): DiagnosticTurnRecord {
  return {
    id: 'turn-1',
    conversationId: 'conversation-a',
    originatingUserMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    capturedAt: 1_700_000_000_050,
    trace: {
      id: 'turn-1',
      createdAt: '2026-07-10T00:00:00.000Z',
      stages: [
        {
          stage: 'answer',
          modelInput: [{ role: 'user', content: 'What is in this photo?' }],
          rawOutput: 'A wooden chair.',
          processedOutput: 'A wooden chair.',
        },
        {
          stage: 'answer',
          modelInput: [{ role: 'user', content: 'What is in this photo?' }],
          rawOutput: 'Retry answer.',
          processedOutput: 'Retry answer.',
          refusalRetry: true,
        },
      ],
      finalResponse: 'Retry answer.',
    },
    objectiveResult: null,
    contextDiagnostics: null,
    ...overrides,
  };
}

const APP_INFO: AppDiagnosticsInfo = {
  modelId: 'LFM2_5_VL_1_6B_QUANTIZED',
  generationConfigId: 'recommended-lfm2-vl-v1',
  pipelineVariantId: 'recommended-sampling-v1',
  appBuildId: '1.0.0+1',
  deviceNameModel: 'Google Pixel 8',
  exportedAt: '2026-07-10T00:00:00.000Z',
};

describe('DiagnosticsBundleBuilder', () => {
  it('builds a readable markdown transcript with title, messages, and timestamps', () => {
    const markdown = buildDiagnosticsMarkdown([makeConversation()]);

    expect(markdown).toContain('What is in this photo?');
    expect(markdown).toContain('**User**');
    expect(markdown).toContain('**Locra**');
    expect(markdown).toContain('A wooden chair.');
    expect(markdown).toContain('conversation-a');
  });

  it('reports no conversations selected when the list is empty', () => {
    expect(buildDiagnosticsMarkdown([])).toContain('No conversations selected.');
  });

  it('builds structured JSON with app info, conversations, and turns', () => {
    const bundle = buildDiagnosticsBundleJson({
      conversations: [makeConversation()],
      turns: [makeTurn()],
      appInfo: APP_INFO,
    });

    expect(bundle.appInfo).toEqual(APP_INFO);
    expect(bundle.conversations).toHaveLength(1);
    expect(bundle.conversations[0]?.messages).toHaveLength(2);
    expect(bundle.turns).toHaveLength(1);
    expect(bundle.turns[0]?.stages).toHaveLength(2);
  });

  it('derives refusalRecoveryTriggered from a stage marked as a refusal retry', () => {
    const bundle = buildDiagnosticsBundleJson({
      conversations: [],
      turns: [makeTurn()],
      appInfo: APP_INFO,
    });

    expect(bundle.turns[0]?.refusalRecoveryTriggered).toBe(true);
  });

  it('reports refusalRecoveryTriggered as false when no stage was a retry', () => {
    const turn = makeTurn({
      trace: {
        id: 'turn-2',
        createdAt: '2026-07-10T00:00:00.000Z',
        stages: [
          {
            stage: 'answer',
            modelInput: [],
            rawOutput: 'Answer.',
            processedOutput: 'Answer.',
          },
        ],
        finalResponse: 'Answer.',
      },
    });

    const bundle = buildDiagnosticsBundleJson({
      conversations: [],
      turns: [turn],
      appInfo: APP_INFO,
    });

    expect(bundle.turns[0]?.refusalRecoveryTriggered).toBe(false);
  });

  it('never inlines image bytes, only source paths', () => {
    const bundle = buildDiagnosticsBundleJson({
      conversations: [makeConversation()],
      turns: [],
      appInfo: APP_INFO,
    });

    const attachment = bundle.conversations[0]?.messages[0]?.attachments[0];
    expect(attachment).toEqual({ kind: 'image', path: '/tmp/photo.jpg' });
  });
});
