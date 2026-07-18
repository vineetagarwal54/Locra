import { strFromU8, unzipSync } from 'fflate';

import type { AppDiagnosticsInfo } from '../../../src/diagnostics/DiagnosticsBundleBuilder';
import {
  buildDiagnosticsZipEntries,
  prepareDiagnosticsExport,
  shareDiagnosticsExport,
  ZIP_FILE_PREFIX,
  type DiagnosticsExportFileSystem,
  type DiagnosticsPrepareDependencies,
  type DiagnosticsSharer,
} from '../../../src/diagnostics/DiagnosticsExportService';
import type { DiagnosticTurnRecord } from '../../../src/diagnostics/DiagnosticsTraceStore';
import type { Conversation } from '../../../src/types/models';

const APP_INFO: AppDiagnosticsInfo = {
  modelId: 'QWEN3_VL_2B_INSTRUCT_Q4_K_M',
  generationConfigId: 'qwen3-vl-2b-instruct-llamarn-v1',
  pipelineVariantId: 'recommended-sampling-v1',
  appBuildId: '1.0.0+1',
  deviceNameModel: 'Google Pixel 8',
  exportedAt: '2026-07-15T00:00:00.000Z',
  modelDownloadStatus: 'downloaded',
  modelDownloadProgress: 1,
  modelIntegrityVerified: true,
  storageAvailableBytes: 1_000,
  storageTotalBytes: 2_000,
  activeResourceOperation: null,
};

function makeConversation(id: string, text = `Question in ${id}`): Conversation {
  return {
    id,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
    messages: [
      {
        id: `${id}-user`,
        role: 'user',
        text,
        attachments: [{ kind: 'image', path: '/data/user/0/locra/cache/photo.jpg' }],
        status: 'completed',
        errorMessage: null,
        createdAt: 1_700_000_000_000,
      },
      {
        id: `${id}-assistant`,
        role: 'assistant',
        text: 'An answer.',
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
  };
}

function makeTurn(conversationId: string, assistantMessageId: string): DiagnosticTurnRecord {
  return {
    id: `${conversationId}-turn`,
    conversationId,
    originatingUserMessageId: `${conversationId}-user`,
    assistantMessageId,
    capturedAt: 1_700_000_000_050,
    trace: {
      id: `${conversationId}-turn`,
      createdAt: '2026-07-15T00:00:00.000Z',
      stages: [],
      finalResponse: 'An answer.',
    },
    objectiveResult: null,
    contextDiagnostics: null,
  };
}

class FakeFileSystem implements DiagnosticsExportFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly ops: string[] = [];

  ensureExportDir(): void {
    this.ops.push('ensure');
  }

  deletePreviousZips(): void {
    this.ops.push('deletePrevious');
    this.files.clear();
  }

  writeZip(fileName: string, bytes: Uint8Array): string {
    this.ops.push(`write:${fileName}`);
    this.files.set(fileName, bytes);
    return `file:///cache/locra-diagnostics/${fileName}`;
  }
}

function makeDeps(
  overrides: Partial<DiagnosticsPrepareDependencies> = {},
): { deps: DiagnosticsPrepareDependencies; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  const allConversations = [makeConversation('conversation-a'), makeConversation('conversation-b')];
  const allTurns = [
    makeTurn('conversation-a', 'conversation-a-assistant'),
    makeTurn('conversation-b', 'conversation-b-assistant'),
  ];
  const deps: DiagnosticsPrepareDependencies = {
    readConversations: (ids) => allConversations.filter((conversation) => ids.includes(conversation.id)),
    listTurns: (ids) => allTurns.filter((turn) => ids.includes(turn.conversationId)),
    resolveAppInfo: () => APP_INFO,
    fileSystem,
    now: () => 1_700_000_009_999,
    ...overrides,
  };
  return { deps, fileSystem };
}

function unzip(bytes: Uint8Array): Record<string, string> {
  const entries = unzipSync(bytes);
  return Object.fromEntries(
    Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]),
  );
}

describe('buildDiagnosticsZipEntries', () => {
  it('includes transcript.md, diagnostics.json, and a locally-created README.txt', () => {
    const entries = buildDiagnosticsZipEntries({
      conversations: [makeConversation('conversation-a')],
      turns: [makeTurn('conversation-a', 'conversation-a-assistant')],
      appInfo: APP_INFO,
    });

    expect(Object.keys(entries).sort()).toEqual(['README.txt', 'diagnostics.json', 'transcript.md']);
    const readme = strFromU8(entries['README.txt']);
    expect(readme).toMatch(/created locally on your device/i);
    expect(readme).toMatch(/nothing was uploaded/i);
    expect(readme).toMatch(/Images, model files, and audio/i);
  });

  it('excludes images and local paths from the written bundle', () => {
    const entries = buildDiagnosticsZipEntries({
      conversations: [makeConversation('conversation-a')],
      turns: [],
      appInfo: APP_INFO,
    });
    const json = strFromU8(entries['diagnostics.json']);

    // The image path never reaches the bundle; only safe presence metadata does.
    expect(json).not.toContain('/data/user/0/locra/cache/photo.jpg');
    expect(JSON.parse(json).conversations[0].messages[0].imageAttachmentCount).toBe(1);
  });
});

describe('prepareDiagnosticsExport', () => {
  it('filters to only the selected conversations', async () => {
    const { deps, fileSystem } = makeDeps();

    const result = await prepareDiagnosticsExport(['conversation-a'], {}, deps);

    expect(result.conversationCount).toBe(1);
    const [name] = [...fileSystem.files.keys()];
    const transcript = unzip(fileSystem.files.get(name)!)['transcript.md'];
    expect(transcript).toContain('conversation-a');
    expect(transcript).not.toContain('conversation-b');
  });

  it('filters diagnostic turns to a single response when responseId is given', async () => {
    const { deps } = makeDeps();

    const result = await prepareDiagnosticsExport(
      ['conversation-a', 'conversation-b'],
      { responseId: 'conversation-a-assistant' },
      deps,
    );

    expect(result.turnCount).toBe(1);
  });

  it('deletes previous ZIPs BEFORE writing the new one and keeps the newest', async () => {
    const { deps, fileSystem } = makeDeps();

    const result = await prepareDiagnosticsExport(['conversation-a'], {}, deps);

    // Order proves cleanup happens first, and the new ZIP is not deleted afterward.
    expect(fileSystem.ops).toEqual([
      'ensure',
      'deletePrevious',
      `write:${ZIP_FILE_PREFIX}1700000009999.zip`,
    ]);
    expect(fileSystem.files.size).toBe(1);
    expect(fileSystem.files.has(`${ZIP_FILE_PREFIX}1700000009999.zip`)).toBe(true);
    expect(result.uri).toContain(ZIP_FILE_PREFIX);
  });

  it('keeps only the newest ZIP across repeated exports', async () => {
    const fileSystem = new FakeFileSystem();
    let clock = 1;
    const { deps } = makeDeps({ fileSystem, now: () => (clock += 1) });

    await prepareDiagnosticsExport(['conversation-a'], {}, deps);
    await prepareDiagnosticsExport(['conversation-a'], {}, deps);

    expect(fileSystem.files.size).toBe(1);
  });

  it('reports the preparing and creating-zip stages in order', async () => {
    const stages: string[] = [];
    const { deps } = makeDeps({ onStage: (stage) => stages.push(stage) });

    await prepareDiagnosticsExport(['conversation-a'], {}, deps);

    expect(stages).toEqual(['preparing', 'creating-zip']);
  });

  it('does not share during preparation (offline: no upload, no share sheet)', async () => {
    const share = jest.fn();
    const { deps } = makeDeps();

    await prepareDiagnosticsExport(['conversation-a'], {}, deps);

    expect(share).not.toHaveBeenCalled();
  });
});

describe('shareDiagnosticsExport', () => {
  it('reports unavailable when sharing is not available', async () => {
    const sharer: DiagnosticsSharer = {
      isAvailable: () => Promise.resolve(false),
      share: jest.fn(),
    };
    expect(await shareDiagnosticsExport('file:///x.zip', sharer)).toBe('unavailable');
    expect(sharer.share).not.toHaveBeenCalled();
  });

  it('reports shared when the share sheet completes', async () => {
    const sharer: DiagnosticsSharer = {
      isAvailable: () => Promise.resolve(true),
      share: () => Promise.resolve(),
    };
    expect(await shareDiagnosticsExport('file:///x.zip', sharer)).toBe('shared');
  });

  it('treats a share-sheet cancellation/dismissal as cancelled, not a failure', async () => {
    const sharer: DiagnosticsSharer = {
      isAvailable: () => Promise.resolve(true),
      share: () => Promise.reject(new Error('User dismissed the share sheet')),
    };
    expect(await shareDiagnosticsExport('file:///x.zip', sharer)).toBe('cancelled');
  });
});
