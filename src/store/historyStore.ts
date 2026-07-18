import { File } from 'expo-file-system';
import { create } from 'zustand';

import { deriveConversationTitle } from '../history/ConversationSearch';
import { fromStoredMode, toStoredMode } from '../inference/ResponseMode';
import { BenchmarkRepository } from '../persistence/BenchmarkRepository';
import { ChunkRepository } from '../persistence/ChunkRepository';
import { ConversationRepository } from '../persistence/ConversationRepository';
import { EmbeddingRepository } from '../persistence/EmbeddingRepository';
import { EvidenceRepository } from '../persistence/EvidenceRepository';
import { FactRepository } from '../persistence/FactRepository';
import { ImageRepository } from '../persistence/ImageRepository';
import { MessageRepository } from '../persistence/MessageRepository';
import { getDatabase } from '../persistence/sqlite/Database';
import { SummaryRepository } from '../persistence/SummaryRepository';
import type { SqliteDriver } from '../persistence/types';
import type { IHistoryStore } from '../types/interfaces';
import type { Conversation, ConversationMessage, ConversationRow, MessageRow, MetricsSummary } from '../types/models';

import {
  createConversationListCache,
  createMessageHistoryCache,
  loadMoreConversations,
  loadNewerConversations,
  loadNewerMessages,
  loadOlderMessages,
} from './conversationHistoryCache';
import { useSettingsStore } from './settingsStore';

const EMPTY_METRICS: MetricsSummary = {
  count: 0,
  averageModelLoadTimeMs: 0,
  averagePreprocessingTimeMs: 0,
  averageFirstTokenLatencyMs: 0,
  averageTokensPerSecond: 0,
  averageTotalWallTimeMs: 0,
};

// Repositories are constructed against a lazy driver so importing screens/stores
// during the database splash cannot open or use SQLite. The first repository call
// resolves `getDatabase()`, which rejects access until bootstrap is ready.
const driver = new Proxy({} as SqliteDriver, {
  get(_target, property: keyof SqliteDriver): SqliteDriver[keyof SqliteDriver] {
    return getDatabase()[property];
  },
});
export const conversationRepository = new ConversationRepository(driver, {
  getDefaultResponseMode: () => toStoredMode(useSettingsStore.getState().defaultResponseMode),
  onUnlinkImageFiles: unlinkFiles,
});
export const messageRepository = new MessageRepository(driver);
export const imageRepository = new ImageRepository(driver, { deleteFile: unlinkFile });
export const evidenceRepository = new EvidenceRepository(driver);
export const chunkRepository = new ChunkRepository(driver);
export const embeddingRepository = new EmbeddingRepository(driver);
export const summaryRepository = new SummaryRepository(driver);
export const factRepository = new FactRepository(driver);
export const benchmarkRepository = new BenchmarkRepository(driver);

export function reconcileAbandonedAttempts(): number {
  const reconciled = messageRepository.reconcileGeneratingAttempts();
  if (reconciled > 0) {
    messageCaches.clear();
    conversationCache = createConversationListCache(conversationRepository);
  }
  return reconciled;
}

/** Complete repository-backed headers for diagnostics selection, independent of UI cache eviction. */
export function listAllConversationHeadersForDiagnostics(): Conversation[] {
  const rows: ConversationRow[] = [];
  let page = conversationRepository.listConversations({ limit: 50 });
  rows.push(...page.items);
  while (page.nextCursor !== null) {
    page = conversationRepository.listConversations({ before: page.nextCursor, limit: 50 });
    rows.push(...page.items);
  }
  return rowsToConversationHeaders(rows);
}

let conversationCache: ReturnType<typeof createConversationListCache> | null = null;
const messageCaches = new Map<string, ReturnType<typeof createMessageHistoryCache>>();

function ensureConversationCache(): ReturnType<typeof createConversationListCache> {
  if (conversationCache === null) {
    imageRepository.reconcileAvailability(fileExists);
    conversationCache = createConversationListCache(conversationRepository);
  }
  return conversationCache;
}

export interface HistoryStoreState {
  conversations: Conversation[];
  metricsSummary: MetricsSummary;
  hasMoreConversations: boolean;
  refresh: () => void;
  loadMore: () => void;
  loadOlderMessages: (conversationId: string) => void;
  loadNewer: () => void;
  loadNewerMessages: (conversationId: string) => void;
  search: (query: string) => Conversation[];
  delete: (id: string) => void;
  rename: (id: string, title: string) => void;
  clear: () => void;
  setFlag: (id: string, flagged: boolean, note?: string) => void;
  getMetricsSummary: () => MetricsSummary;
  saveConversation: (conversation: Conversation) => void;
  getConversation: (id: string) => Conversation | null;
  listConversations: (limit?: number, offset?: number) => Conversation[];
}

export const useHistoryStore = create<HistoryStoreState>((set, get) => ({
  conversations: [],
  metricsSummary: EMPTY_METRICS,
  hasMoreConversations: false,
  refresh: (): void => {
    conversationCache = createConversationListCache(conversationRepository);
    set(listSnapshot());
  },
  loadMore: (): void => {
    loadMoreConversations(ensureConversationCache(), conversationRepository);
    set(listSnapshot());
  },
  loadNewer: (): void => {
    loadNewerConversations(ensureConversationCache(), conversationRepository);
    set(listSnapshot());
  },
  loadOlderMessages: (conversationId: string): void => {
    const cache = getMessageCache(conversationId);
    loadOlderMessages(cache, messageRepository, conversationId);
    set({ conversations: [...get().conversations] });
  },
  loadNewerMessages: (conversationId: string): void => {
    const cache = getMessageCache(conversationId);
    loadNewerMessages(cache, messageRepository, conversationId);
    set({ conversations: [...get().conversations] });
  },
  search: (query: string): Conversation[] =>
    rowsToConversationHeaders(conversationRepository.searchConversations(query)),
  delete: (id: string): void => {
    conversationRepository.deleteConversation(id);
    messageCaches.delete(id);
    conversationCache = createConversationListCache(conversationRepository);
    set(listSnapshot());
  },
  rename: (id: string, title: string): void => {
    const trimmed = title.trim();
    if (trimmed === '') return;
    conversationRepository.updateConversation(id, { title: trimmed, touch: true });
    conversationCache = createConversationListCache(conversationRepository);
    set(listSnapshot());
  },
  clear: (): void => {
    let page = conversationRepository.listConversations({ limit: 50 });
    while (page.items.length > 0) {
      for (const row of page.items) {
        conversationRepository.deleteConversation(row.id);
      }
      page = conversationRepository.listConversations({ limit: 50 });
    }
    messageCaches.clear();
    conversationCache = createConversationListCache(conversationRepository);
    set(listSnapshot());
  },
  setFlag: (): void => {
    // Flags remain a diagnostics concern until their SQL schema lands.
  },
  getMetricsSummary: (): MetricsSummary => EMPTY_METRICS,
  saveConversation: (conversation: Conversation): void => {
    persistConversationSnapshot(conversation);
    messageCaches.delete(conversation.id);
    conversationCache = createConversationListCache(conversationRepository);
    set(listSnapshot());
  },
  getConversation: (id: string): Conversation | null => materializeConversation(id),
  listConversations: (limit = 50, offset = 0): Conversation[] =>
    get().conversations.slice(offset, offset + Math.min(limit, 50)),
}));

export const historyStore: IHistoryStore = {
  save: (conversation) => useHistoryStore.getState().saveConversation(conversation),
  get: (id) => useHistoryStore.getState().getConversation(id),
  list: (limit, offset) => useHistoryStore.getState().listConversations(limit, offset),
  delete: (id) => useHistoryStore.getState().delete(id),
  clear: () => useHistoryStore.getState().clear(),
  setFlag: (id, flagged, note) => useHistoryStore.getState().setFlag(id, flagged, note),
  getMetricsSummary: () => EMPTY_METRICS,
};

function listSnapshot(): Pick<HistoryStoreState, 'conversations' | 'metricsSummary' | 'hasMoreConversations'> {
  return {
    conversations: rowsToConversationHeaders(ensureConversationCache().items()),
    metricsSummary: EMPTY_METRICS,
    hasMoreConversations: ensureConversationCache().hasMore(),
  };
}

function rowsToConversationHeaders(rows: ConversationRow[]): Conversation[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: [],
    status: 'idle',
    errorMessage: null,
    metrics: null,
    flagged: false,
    flagNote: null,
    contextMemory: null,
    responseMode: fromStoredMode(row.response_mode),
    latestMessagePreview: row.latest_message_preview,
    hasImage: row.has_image === 1,
  }));
}

function getMessageCache(conversationId: string): ReturnType<typeof createMessageHistoryCache> {
  const existing = messageCaches.get(conversationId);
  if (existing !== undefined) {
    return existing;
  }
  const created = createMessageHistoryCache(messageRepository, conversationId);
  messageCaches.set(conversationId, created);
  return created;
}

function materializeConversation(id: string): Conversation | null {
  const row = conversationRepository.getConversation(id);
  if (row === null) {
    return null;
  }
  const cachedRows = getMessageCache(id).items();
  const activeRows = activeProjection(cachedRows).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  const messages = activeRows.map(toConversationMessage);
  const last = messages.at(-1);
  return {
    ...rowsToConversationHeaders([row])[0],
    messages,
    status: last?.status === 'generating' ? 'streaming'
      : last?.status === 'failed' ? 'errored'
        : last?.status === 'interrupted' ? 'cancelled'
          : messages.length === 0 ? 'idle' : 'completed',
    errorMessage: last?.errorMessage ?? null,
  };
}

function activeProjection(rows: MessageRow[]): MessageRow[] {
  return rows.filter((row) => row.role === 'user' || row.is_active_attempt === 1);
}

function toConversationMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    attachments: row.role === 'user'
      ? imageRepository.getAssetsForMessage(row.id).map((asset) => ({
          kind: 'image' as const,
          path: asset.local_path,
          available: asset.available === 1,
        }))
      : [],
    status: row.role === 'user' ? 'completed' : row.status === 'submitted' ? 'completed' : row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    finishReason: row.role === 'assistant' ? row.finish_reason : null,
  };
}

function persistConversationSnapshot(conversation: Conversation): void {
  let persistedConversation = conversationRepository.getConversation(conversation.id);
  if (persistedConversation === null) {
    persistedConversation = conversationRepository.createConversation({
      id: conversation.id,
      responseMode: toStoredMode(
        conversation.responseMode ?? useSettingsStore.getState().defaultResponseMode,
      ),
    });
  }
  for (const message of conversation.messages) {
    const existing = messageRepository.getMessage(message.id);
    if (message.role === 'user') {
      if (existing === null) {
        messageRepository.appendUserMessage({ id: message.id, conversationId: conversation.id, text: message.text, createdAt: message.createdAt });
        message.attachments.forEach((attachment, ordinal) => {
          const asset = imageRepository.createOrReuseAsset({ conversationId: conversation.id, localPath: attachment.path });
          imageRepository.linkToMessage(message.id, asset.id, ordinal);
        });
      }
      continue;
    }
    if (existing === null) {
      const source = findPreviousUser(conversation.messages, message.id);
      if (source !== null) {
        messageRepository.createAssistantAttempt(source.id, { id: message.id, createdAt: message.createdAt });
      }
    }
    messageRepository.updateAssistantStreamingText(message.id, message.text);
    if (message.status !== 'generating') {
      messageRepository.finalizeAttempt(
        message.id,
        message.status,
        message.errorMessage,
        message.finishReason ?? null,
      );
    }
  }
  conversationRepository.updateConversation(conversation.id, {
    ...(persistedConversation.title === null && conversation.messages.length > 0
      ? { title: deriveConversationTitle(conversation) }
      : {}),
    touch: true,
  });
}

function findPreviousUser(messages: ConversationMessage[], assistantId: string): ConversationMessage | null {
  const index = messages.findIndex((message) => message.id === assistantId);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = messages[cursor];
    if (candidate?.role === 'user') {
      return candidate;
    }
  }
  return null;
}

function unlinkFiles(paths: ReadonlyArray<string>): void {
  paths.forEach(unlinkFile);
}

function unlinkFile(path: string): void {
  const file = new File(path.startsWith('file://') ? path : `file://${path}`);
  if (file.exists) {
    file.delete();
  }
}

function fileExists(path: string): boolean {
  try {
    return new File(path.startsWith('file://') ? path : `file://${path}`).exists;
  } catch {
    return false;
  }
}
