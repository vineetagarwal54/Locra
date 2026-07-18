// Native wiring for the diagnostics export. This is the ONLY diagnostics-export
// module that touches expo-file-system / expo-sharing and the app singletons; the
// testable logic lives in DiagnosticsExportService.ts and is injected here.

import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { deviceResourcePolicy } from '../inference/DeviceResourcePolicy';
import { CURRENT_PIPELINE_VARIANT_ID } from '../inference/GenerationTuning';
import { QWEN_V1_DESCRIPTOR } from '../model/ActiveModel';
import { conversationRepository, imageRepository, messageRepository } from '../store/historyStore';
import { useModelStore } from '../store/modelStore';

import { getCurrentDeviceBuildMetadata } from './DeviceBuildMetadataProvider';
import type { AppDiagnosticsInfo } from './DiagnosticsBundleBuilder';
import {
  EXPORT_DIR_NAME,
  prepareDiagnosticsExport,
  shareDiagnosticsExport,
  ZIP_FILE_PREFIX,
  type DiagnosticsExportOptions,
  type DiagnosticsExportFileSystem,
  type DiagnosticsExportPrepareResult,
  type DiagnosticsExportStage,
  type DiagnosticsShareOutcome,
  type DiagnosticsSharer,
} from './DiagnosticsExportService';
import { DiagnosticsRepositoryReader } from './DiagnosticsRepositoryReader';
import { diagnosticsTraceStore, type DiagnosticTurnRecord } from './DiagnosticsTraceStore';

const realFileSystem: DiagnosticsExportFileSystem = {
  ensureExportDir(): void {
    const directory = new Directory(Paths.cache, EXPORT_DIR_NAME);
    if (!directory.exists) {
      directory.create({ intermediates: true });
    }
  },
  deletePreviousZips(): void {
    deleteAllDiagnosticsZips();
  },
  writeZip(fileName: string, bytes: Uint8Array): string {
    const directory = new Directory(Paths.cache, EXPORT_DIR_NAME);
    const zipFile = new File(directory, fileName);
    zipFile.create({ overwrite: true });
    zipFile.write(bytes);
    return zipFile.uri;
  },
};

const realSharer: DiagnosticsSharer = {
  isAvailable: () => Sharing.isAvailableAsync(),
  share: (uri: string) =>
    Sharing.shareAsync(uri, {
      mimeType: 'application/zip',
      dialogTitle: 'Share Locra diagnostics',
    }),
};

/** Prepares (writes, does not share) the diagnostics ZIP for the selected chats. */
export function prepareDiagnosticsExportBundle(
  conversationIds: ReadonlyArray<string>,
  options: DiagnosticsExportOptions = {},
  onStage?: (stage: DiagnosticsExportStage) => void,
): Promise<DiagnosticsExportPrepareResult> {
  return prepareDiagnosticsExport(conversationIds, options, {
    readConversations: (ids) =>
      new DiagnosticsRepositoryReader(conversationRepository, messageRepository, imageRepository).read(ids),
    listTurns: (ids) => diagnosticsTraceStore.list(ids),
    resolveAppInfo,
    fileSystem: realFileSystem,
    now: Date.now,
    ...(onStage === undefined ? {} : { onStage }),
  });
}

/** Opens the OS share sheet for a prepared ZIP; cancellation is not a failure. */
export function shareDiagnosticsExportBundle(uri: string): Promise<DiagnosticsShareOutcome> {
  return shareDiagnosticsExport(uri, realSharer);
}

/**
 * Deletes every generated diagnostics ZIP (used by "Clear diagnostics"). Never
 * touches conversations or image files — only the export ZIPs in the cache dir.
 */
export function deleteAllDiagnosticsExports(): void {
  deleteAllDiagnosticsZips();
}

function deleteAllDiagnosticsZips(): void {
  const directory = new Directory(Paths.cache, EXPORT_DIR_NAME);
  if (!directory.exists) {
    return;
  }
  for (const entry of directory.list()) {
    if (entry instanceof File && entry.name.startsWith(ZIP_FILE_PREFIX) && entry.exists) {
      entry.delete();
    }
  }
}

function resolveAppInfo(turns: ReadonlyArray<DiagnosticTurnRecord>): AppDiagnosticsInfo {
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
