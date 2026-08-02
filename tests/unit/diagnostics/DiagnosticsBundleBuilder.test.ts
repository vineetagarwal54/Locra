import {
  buildDiagnosticsBundleJson,
  buildDiagnosticsMarkdown,
  sanitizeSensitive,
  type AppDiagnosticsInfo,
} from '../../../src/diagnostics/DiagnosticsBundleBuilder';
import type {
  DiagnosticTurnRecord,
  ProductionDiagnosticTurnSummary,
} from '../../../src/diagnostics/DiagnosticsTraceStore';
import type { Conversation } from '../../../src/types/models';

function makeSummary(
  overrides: Partial<ProductionDiagnosticTurnSummary> = {},
): ProductionDiagnosticTurnSummary {
  return {
    responseMode: 'Medium',
    requestKind: 'image',
    promptTokenCount: 44,
    generatedTokenCount: 6,
    firstTokenTimeMs: 120,
    totalTimeMs: 700,
    finishReason: 'natural',
    looping: false,
    truncated: false,
    contextSelection: {
      recentTurnsConsidered: 0,
      recentTurnsSelected: 0,
      mediaEvidenceSelected: 0,
      factsSelected: 0,
      summariesSelected: 0,
      budgetMaximumUnits: 1000,
      budgetUsedUnits: 0,
    },
    targetTokenCount: 320,
    generationLimit: 512,
    samplingProfile: { id: 'test-sampling-v1', temperature: 0.7, topP: 0.9, topK: 40 },
    imageSupplied: true,
    modelId: 'QWEN3_VL_2B_INSTRUCT_Q4_K_M',
    generationConfigId: 'qwen3-vl-2b-instruct-llamarn-v1',
    pipelineVariantId: 'qwen-visible-sampling-v2',
    appBuildId: '1.0.0+1',
    ...overrides,
  };
}

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
  gitCommitSha: 'abc1234',
  gitBranch: 'main',
  gitDirty: false,
  deviceNameModel: 'Google Pixel 8',
  exportedAt: '2026-07-10T00:00:00.000Z',
  modelDownloadStatus: 'downloaded',
  modelDownloadProgress: 1,
  modelIntegrityVerified: true,
  storageAvailableBytes: 1_000,
  storageTotalBytes: 2_000,
  activeResourceOperation: null,
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

  it('exports the git build-provenance fields in app info', () => {
    const bundle = buildDiagnosticsBundleJson({
      conversations: [],
      turns: [],
      appInfo: APP_INFO,
    });

    expect(bundle.appInfo.gitCommitSha).toBe('abc1234');
    expect(bundle.appInfo.gitBranch).toBe('main');
    expect(bundle.appInfo.gitDirty).toBe(false);
  });

  it('passes through native completion, image provenance, and cancellation stage in the summary', () => {
    const summary = makeSummary({
      nativeCompletion: {
        stoppedEos: true,
        stoppedWord: false,
        stoppedLimit: false,
        truncated: false,
        generatedTokenCount: 6,
        generationLimit: 512,
      },
      imageProvenance: {
        pixelsSupplied: true,
        imageIdentifier: 'asset://image-123',
        source: 'current-attachment',
      },
      cancellationStage: null,
    });

    const bundle = buildDiagnosticsBundleJson({
      conversations: [],
      turns: [makeTurn({ trace: null, summary })],
      appInfo: APP_INFO,
    });

    expect(bundle.turns[0]?.summary?.nativeCompletion).toEqual(summary.nativeCompletion);
    expect(bundle.turns[0]?.summary?.imageProvenance?.pixelsSupplied).toBe(true);
    expect(bundle.turns[0]?.summary?.imageProvenance?.imageIdentifier).toBe('asset://image-123');
  });

  it('sanitizes a local image path carried in the summary image provenance', () => {
    const summary = makeSummary({
      imageProvenance: {
        pixelsSupplied: true,
        imageIdentifier: 'file:///data/user/0/app/cache/photo.jpg',
        source: 'current-attachment',
      },
    });

    const bundle = buildDiagnosticsBundleJson({
      conversations: [],
      turns: [makeTurn({ trace: null, summary })],
      appInfo: APP_INFO,
    });

    expect(bundle.turns[0]?.summary?.imageProvenance?.imageIdentifier).toBe('[local path omitted]');
    expect(JSON.stringify(bundle)).not.toContain('/data/user/0/app/cache/photo.jpg');
  });

  it('still exports a turn whose summary omits the optional diagnostic fields', () => {
    const summary = makeSummary(); // no imageProvenance / nativeCompletion / cancellationStage

    const bundle = buildDiagnosticsBundleJson({
      conversations: [],
      turns: [makeTurn({ trace: null, summary })],
      appInfo: APP_INFO,
    });

    expect(bundle.turns).toHaveLength(1);
    expect(bundle.turns[0]?.summary?.imageProvenance).toBeUndefined();
    expect(bundle.turns[0]?.summary?.nativeCompletion).toBeUndefined();
    expect(bundle.turns[0]?.summary?.modelId).toBe('QWEN3_VL_2B_INSTRUCT_Q4_K_M');
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

  it('excludes images and sanitizes local paths by default', () => {
    const conversation = makeConversation();
    conversation.messages[1].errorMessage = 'Failed near C:\\Users\\me\\photo.jpg';
    const bundle = buildDiagnosticsBundleJson({
      conversations: [conversation],
      turns: [makeTurn({
        trace: {
          id: 'turn-path',
          createdAt: '2026-07-10T00:00:00.000Z',
          stages: [{
            stage: 'answer',
            modelInput: [{ role: 'user', content: 'question', mediaPath: 'file:///data/photo.jpg' }],
            rawOutput: 'answer',
            processedOutput: 'answer',
          }],
          finalResponse: 'answer',
        },
      })],
      appInfo: APP_INFO,
    });

    expect(bundle.conversations[0]?.messages[0]?.imageAttachmentCount).toBe(1);
    expect(JSON.stringify(bundle)).not.toContain('/tmp/photo.jpg');
    expect(JSON.stringify(bundle)).not.toContain('C:\\Users\\me');
    expect(JSON.stringify(bundle)).not.toContain('file:///data/photo.jpg');
    expect(JSON.stringify(bundle)).toContain('[local path omitted]');
  });

  it('redacts secrets and tokens from message text before writing', () => {
    const conversation = makeConversation();
    conversation.messages[0].text =
      'Use api_key=sk-ABCDEF123456 and Authorization: Bearer abcdef.ghijkl.mnopqr to call it.';
    conversation.messages[1].text =
      'token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payloadpart.signaturepart';

    const bundle = buildDiagnosticsBundleJson({
      conversations: [conversation],
      turns: [],
      appInfo: APP_INFO,
    });
    const serialized = JSON.stringify(bundle);

    expect(serialized).not.toContain('sk-ABCDEF123456');
    expect(serialized).not.toContain('abcdef.ghijkl.mnopqr');
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(serialized).toContain('[redacted]');
  });

  it('sanitizeSensitive redacts common credential shapes but leaves plain text intact', () => {
    expect(sanitizeSensitive('secret=hunter2hunter2')).toBe('secret=[redacted]');
    expect(sanitizeSensitive('password: correcthorse')).toBe('password=[redacted]');
    expect(sanitizeSensitive('Bearer abcdef1234567890')).toBe('Bearer [redacted]');
    expect(sanitizeSensitive('The chair is wooden and brown.')).toBe(
      'The chair is wooden and brown.',
    );
  });
});
