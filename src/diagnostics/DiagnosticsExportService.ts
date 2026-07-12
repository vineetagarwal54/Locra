import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strToU8, zipSync } from 'fflate';

import { CURRENT_PIPELINE_VARIANT_ID } from '../inference/GenerationTuning';
import { getStartupRuntimeSelection } from '../inference/StartupRuntimeSelection';
import { QWEN_V1_DESCRIPTOR } from '../model/ActiveModel';
import { historyStore } from '../store/historyStore';
import { requireSelectedModel } from '../store/modelSelectionStore';
import type { Conversation } from '../types/models';

import { getCurrentDeviceBuildMetadata } from './DeviceBuildMetadataProvider';
import {
  buildDiagnosticsBundleJson,
  buildDiagnosticsMarkdown,
  type AppDiagnosticsInfo,
} from './DiagnosticsBundleBuilder';
import { diagnosticsTraceStore, type DiagnosticTurnRecord } from './DiagnosticsTraceStore';

const EXPORT_DIR_NAME = 'locra-diagnostics';
const ZIP_FILE_PREFIX = 'locra-diagnostics-';

export interface DiagnosticsExportResult {
  readonly uri: string;
  readonly conversationCount: number;
  readonly turnCount: number;
}

export async function exportDiagnosticsBundle(
  conversationIds: ReadonlyArray<string>,
): Promise<DiagnosticsExportResult> {
  const conversations = collectConversations(conversationIds);
  const turns = diagnosticsTraceStore.list(conversationIds);
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

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(zipFile.uri, {
      mimeType: 'application/zip',
      dialogTitle: 'Export Locra diagnostics',
    });
  }

  return { uri: zipFile.uri, conversationCount: conversations.length, turnCount: turns.length };
}

function collectConversations(conversationIds: ReadonlyArray<string>): Conversation[] {
  return conversationIds
    .map((id) => historyStore.get(id))
    .filter((conversation): conversation is Conversation => conversation !== null);
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
  return {
    modelId: mostRecentObjectiveResult?.modelId ?? attribution.modelId,
    generationConfigId:
      mostRecentObjectiveResult?.generationConfigId ?? attribution.generationConfigId,
    pipelineVariantId: CURRENT_PIPELINE_VARIANT_ID,
    appBuildId: deviceMetadata.appBuildId,
    deviceNameModel: deviceMetadata.deviceNameModel,
    exportedAt: new Date().toISOString(),
  };
}

// Resolves the aggregate model attribution for the active runtime. Under the Qwen
// V1 host there is no normal-user model selection, so we attribute to the safe
// aggregate descriptor id/config rather than throwing on `requireSelectedModel()`
// or exposing raw native internals.
function resolveDiagnosticsModelAttribution(): { modelId: string; generationConfigId: string } {
  if (getStartupRuntimeSelection().selectedHost === 'qwen-llamarn') {
    return {
      modelId: QWEN_V1_DESCRIPTOR.id,
      generationConfigId: QWEN_V1_DESCRIPTOR.generationConfigId,
    };
  }
  const selectedModel = requireSelectedModel();
  return { modelId: selectedModel.id, generationConfigId: selectedModel.generationConfigId };
}
