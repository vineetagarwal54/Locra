import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strToU8, zipSync } from 'fflate';

import { deviceResourcePolicy } from '../inference/DeviceResourcePolicy';
import { CURRENT_PIPELINE_VARIANT_ID } from '../inference/GenerationTuning';
import { QWEN_V1_DESCRIPTOR } from '../model/ActiveModel';
import { conversationRepository, messageRepository } from '../store/historyStore';
import { useModelStore } from '../store/modelStore';

import { getCurrentDeviceBuildMetadata } from './DeviceBuildMetadataProvider';
import {
  buildDiagnosticsBundleJson,
  buildDiagnosticsMarkdown,
  type AppDiagnosticsInfo,
} from './DiagnosticsBundleBuilder';
import { DiagnosticsRepositoryReader } from './DiagnosticsRepositoryReader';
import { diagnosticsTraceStore, type DiagnosticTurnRecord } from './DiagnosticsTraceStore';

const EXPORT_DIR_NAME = 'locra-diagnostics';
const ZIP_FILE_PREFIX = 'locra-diagnostics-';

export interface DiagnosticsExportResult {
  readonly uri: string;
  readonly conversationCount: number;
  readonly turnCount: number;
}

export interface DiagnosticsExportOptions {
  readonly responseId?: string;
}

export async function exportDiagnosticsBundle(
  conversationIds: ReadonlyArray<string>,
  options: DiagnosticsExportOptions = {},
): Promise<DiagnosticsExportResult> {
  const conversations = new DiagnosticsRepositoryReader(
    conversationRepository,
    messageRepository,
  ).read(conversationIds);
  const turns = diagnosticsTraceStore.list(conversationIds).filter(
    (turn) => options.responseId === undefined || turn.assistantMessageId === options.responseId,
  );
  const appInfo = resolveAppDiagnosticsInfo(turns);

  const markdown = buildDiagnosticsMarkdown(conversations);
  const json = buildDiagnosticsBundleJson({ conversations, turns, appInfo });

  const exportDirectory = new Directory(Paths.cache, EXPORT_DIR_NAME);
  if (!exportDirectory.exists) {
    exportDirectory.create({ intermediates: true });
  }
  cleanPreviousExports(exportDirectory);

  const zipBytes = zipSync({
    'transcript.md': strToU8(markdown),
    'diagnostics.json': strToU8(JSON.stringify(json, null, 2)),
  });

  const zipFile = new File(exportDirectory, `${ZIP_FILE_PREFIX}${Date.now()}.zip`);
  zipFile.create({ overwrite: true });
  zipFile.write(zipBytes);

  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(zipFile.uri, {
        mimeType: 'application/zip',
        dialogTitle: 'Export Locra diagnostics',
      });
    }
  } finally {
    if (zipFile.exists) {
      zipFile.delete();
    }
  }

  return { uri: zipFile.uri, conversationCount: conversations.length, turnCount: turns.length };
}

function cleanPreviousExports(directory: Directory): void {
  for (const entry of directory.list()) {
    if (entry instanceof File && entry.name.startsWith(ZIP_FILE_PREFIX)) {
      entry.delete();
    }
  }
}

function resolveAppDiagnosticsInfo(turns: ReadonlyArray<DiagnosticTurnRecord>): AppDiagnosticsInfo {
  const mostRecentObjectiveResult = [...turns]
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .find((turn) => turn.objectiveResult !== null)?.objectiveResult;
  const deviceMetadata = getCurrentDeviceBuildMetadata();
  const attribution = resolveDiagnosticsModelAttribution();
  const modelState = useModelStore.getState();
  return {
    modelId: mostRecentObjectiveResult?.modelId ?? attribution.modelId,
    generationConfigId:
      mostRecentObjectiveResult?.generationConfigId ?? attribution.generationConfigId,
    pipelineVariantId: CURRENT_PIPELINE_VARIANT_ID,
    appBuildId: deviceMetadata.appBuildId,
    deviceNameModel: deviceMetadata.deviceNameModel,
    exportedAt: new Date().toISOString(),
    modelDownloadStatus: modelState.downloadStatus,
    modelDownloadProgress: modelState.downloadProgress,
    modelIntegrityVerified: modelState.integrityVerified,
    storageAvailableBytes: Paths.availableDiskSpace,
    storageTotalBytes: Paths.totalDiskSpace,
    activeResourceOperation: deviceResourcePolicy.current(),
  };
}

// Resolves the aggregate model attribution for the active runtime. Under the Qwen
// V1 host there is no normal-user model selection, so we attribute to the safe
// aggregate descriptor id/config rather than throwing on `requireSelectedModel()`
// or exposing raw native internals.
function resolveDiagnosticsModelAttribution(): { modelId: string; generationConfigId: string } {
  return {
    modelId: QWEN_V1_DESCRIPTOR.id,
    generationConfigId: QWEN_V1_DESCRIPTOR.generationConfigId,
  };
}
