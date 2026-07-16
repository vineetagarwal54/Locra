// Runtime-neutral core for the offline diagnostics ZIP export. This module has NO
// native (expo-file-system / expo-sharing) or singleton (repository / store)
// imports so it is fully unit-testable; the real wiring lives in
// DiagnosticsExportRuntime.ts and is injected as dependencies.
//
// The export is fully offline: nothing is ever uploaded. A ZIP is written to the
// cache directory and only shared through the OS share sheet AFTER the user
// confirms. The newest ZIP is kept on disk until the next export or a
// diagnostics/temporary-file cleanup.

import { strToU8, zipSync } from 'fflate';

import type { Conversation } from '../types/models';

import {
  buildDiagnosticsBundleJson,
  buildDiagnosticsMarkdown,
  type AppDiagnosticsInfo,
} from './DiagnosticsBundleBuilder';
import type { DiagnosticTurnRecord } from './DiagnosticsTraceStore';

export const EXPORT_DIR_NAME = 'locra-diagnostics';
export const ZIP_FILE_PREFIX = 'locra-diagnostics-';

export interface DiagnosticsExportOptions {
  /** When set, only diagnostic turns for this assistant response are included. */
  readonly responseId?: string;
}

export type DiagnosticsExportStage = 'preparing' | 'creating-zip';

export interface DiagnosticsExportPrepareResult {
  readonly uri: string;
  readonly fileName: string;
  readonly conversationCount: number;
  readonly turnCount: number;
}

export type DiagnosticsShareOutcome = 'shared' | 'cancelled' | 'unavailable';

/** File operations the export needs; the runtime binds these to expo-file-system. */
export interface DiagnosticsExportFileSystem {
  ensureExportDir(): void;
  /** Deletes every existing diagnostics ZIP (safely) so only the newest is kept. */
  deletePreviousZips(): void;
  /** Writes the ZIP and returns its shareable uri. Must NOT delete it afterwards. */
  writeZip(fileName: string, bytes: Uint8Array): string;
}

/** Share surface the export needs; the runtime binds these to expo-sharing. */
export interface DiagnosticsSharer {
  isAvailable(): Promise<boolean>;
  share(uri: string): Promise<void>;
}

export interface DiagnosticsPrepareDependencies {
  readConversations(conversationIds: ReadonlyArray<string>): Conversation[];
  listTurns(conversationIds: ReadonlyArray<string>): DiagnosticTurnRecord[];
  resolveAppInfo(turns: ReadonlyArray<DiagnosticTurnRecord>): AppDiagnosticsInfo;
  fileSystem: DiagnosticsExportFileSystem;
  now: () => number;
  onStage?: (stage: DiagnosticsExportStage) => void;
}

/**
 * Builds the three in-memory ZIP entries. Pure: excludes images/model files/audio,
 * relies on the bundle builder to sanitize paths/secrets/metadata, and adds a
 * plain-language README describing what is (and is not) included.
 */
export function buildDiagnosticsZipEntries(input: {
  conversations: ReadonlyArray<Conversation>;
  turns: ReadonlyArray<DiagnosticTurnRecord>;
  appInfo: AppDiagnosticsInfo;
}): Record<string, Uint8Array> {
  const markdown = buildDiagnosticsMarkdown(input.conversations);
  const json = buildDiagnosticsBundleJson(input);
  const readme = buildReadmeText(input.conversations.length, input.turns.length);
  return {
    'transcript.md': strToU8(markdown),
    'diagnostics.json': strToU8(JSON.stringify(json, null, 2)),
    'README.txt': strToU8(readme),
  };
}

/**
 * Prepares (does NOT share) a diagnostics ZIP for the selected conversations:
 * reads the selected transcripts, builds the sanitized bundle, deletes older ZIPs,
 * then writes and KEEPS the new ZIP. Returns its uri for a later, user-confirmed
 * share.
 */
export async function prepareDiagnosticsExport(
  conversationIds: ReadonlyArray<string>,
  options: DiagnosticsExportOptions,
  deps: DiagnosticsPrepareDependencies,
): Promise<DiagnosticsExportPrepareResult> {
  deps.onStage?.('preparing');
  const conversations = deps.readConversations(conversationIds);
  const turns = deps
    .listTurns(conversationIds)
    .filter((turn) => options.responseId === undefined || turn.assistantMessageId === options.responseId);
  const appInfo = deps.resolveAppInfo(turns);
  const entries = buildDiagnosticsZipEntries({ conversations, turns, appInfo });

  deps.onStage?.('creating-zip');
  const bytes = zipSync(entries);

  deps.fileSystem.ensureExportDir();
  // Delete older ZIPs BEFORE writing the new one so the newest is what remains on
  // disk (kept until the next export or a diagnostics/temporary-file cleanup).
  deps.fileSystem.deletePreviousZips();
  const fileName = `${ZIP_FILE_PREFIX}${deps.now()}.zip`;
  const uri = deps.fileSystem.writeZip(fileName, bytes);

  return { uri, fileName, conversationCount: conversations.length, turnCount: turns.length };
}

/**
 * Opens the OS share sheet for an already-prepared ZIP. Dismissing/cancelling the
 * share sheet is reported as `cancelled`, never a failure — the ZIP is untouched
 * and stays available to share again.
 */
export async function shareDiagnosticsExport(
  uri: string,
  sharer: DiagnosticsSharer,
): Promise<DiagnosticsShareOutcome> {
  if (!(await sharer.isAvailable())) {
    return 'unavailable';
  }
  try {
    await sharer.share(uri);
    return 'shared';
  } catch {
    // The ZIP was created successfully; a share-sheet dismissal/cancellation is not
    // an export failure. The file remains on disk for another attempt.
    return 'cancelled';
  }
}

function buildReadmeText(conversationCount: number, turnCount: number): string {
  return [
    'Locra diagnostics export',
    '========================',
    '',
    'This ZIP was created locally on your device. Nothing was uploaded anywhere;',
    'it exists only where you saved or shared it.',
    '',
    `It covers ${conversationCount} selected conversation(s) and ${turnCount} diagnostic turn(s).`,
    '',
    'Included files:',
    '  - transcript.md    Readable transcript of the selected conversation(s).',
    '  - diagnostics.json  Structured data: response attempts, inference timings,',
    '                      context-selection diagnostics, and app / build / model /',
    '                      database versions plus model, storage, and recent-error state.',
    '  - README.txt        This file.',
    '',
    'Excluded by design:',
    '  - Images, model files, and audio.',
    '  - Secrets, tokens, and absolute local file paths (redacted).',
    '  - Personally identifying device identifiers.',
    '',
    'Selected conversation text and response attempts may still contain personal',
    'information you typed. Review the contents before sharing this ZIP with anyone.',
    '',
  ].join('\n');
}
