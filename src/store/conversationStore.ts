import { diagnosticsTraceStore } from '../diagnostics/DiagnosticsTraceStore';
import {
  type CanonicalConversationContext,
} from '../inference/ContextBuilder';
import {
  ContextOrchestrator,
  createCanonicalConversationSnapshot,
  mergeVisualEvidenceIntoMemory,
  type ContextSelectionDiagnostics,
} from '../inference/ContextOrchestrator';
import { inferenceQueue } from '../inference/InferenceService';
import { isDevelopmentInferenceTraceEnabled } from '../inference/InferenceTrace';
import type { HiddenVisualEvidence } from '../inference/OutputPipelineTypes';
import { DEFAULT_RESPONSE_MODE, type ResponseMode, toStoredMode } from '../inference/ResponseMode';
import type { IConversationStore, IHistoryStore, IInferenceQueue } from '../types/interfaces';
import type {
  Conversation,
  ConversationMessage,
  ConversationRuntimeState,
  Draft,
  InferenceRequest,
  InferenceState,
  MessageStatus,
} from '../types/models';

import { conversationRepository, evidenceRepository, historyStore, imageRepository, useHistoryStore } from './historyStore';
import { useSettingsStore } from './settingsStore';

export interface ConversationStoreDependencies {
  inferenceQueue: IInferenceQueue;
  historyStore: IHistoryStore;
  contextOrchestrator?: ContextOrchestrator;
  now?: () => number;
  createId?: (prefix: string) => string;
  getDefaultResponseMode?: () => ResponseMode;
  setPersistedResponseMode?: (conversationId: string, mode: ResponseMode) => void;
  persistEvidence?: (conversationId: string, sourceMessageId: string, evidence: HiddenVisualEvidence) => void;
}

interface ActiveGeneration {
  conversationId: string;
  originatingUserMessageId: string;
  assistantMessageId: string;
  contextDiagnostics?: ContextSelectionDiagnostics;
  responseMode: ResponseMode;
}

interface SubmitResult {
  conversationId: string;
  originatingUserMessageId: string;
  assistantMessageId: string;
}

export class ConversationStore implements IConversationStore {
  private readonly runtimeStates = new Map<string, ConversationRuntimeState>();
  private readonly drafts = new Map<string, Draft>();
  private readonly responseModes = new Map<string, ResponseMode>();
  private readonly listeners = new Map<
    string,
    Set<(state: ConversationRuntimeState | null) => void>
  >();
  private activeGeneration: ActiveGeneration | null = null;

  constructor(private readonly dependencies: Required<ConversationStoreDependencies>) {
    this.dependencies.inferenceQueue.subscribe((state) => this.handleInferenceState(state));
  }

  getConversationRuntimeState(conversationId: string): ConversationRuntimeState | null {
    return this.runtimeStates.get(conversationId) ?? null;
  }

  subscribeToConversation(
    conversationId: string,
    listener: (state: ConversationRuntimeState | null) => void
  ): () => void {
    const listeners = this.listeners.get(conversationId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(conversationId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(conversationId);
      }
    };
  }

  async submit(
    conversationId: string | 'new',
    request: { question: string; imagePath: string | null }
  ): Promise<SubmitResult> {
    this.assertCanStartGeneration();

    const resolvedConversationId =
      conversationId === 'new' ? this.dependencies.createId('conversation') : conversationId;
    const previousConversation = this.dependencies.historyStore.get(resolvedConversationId);
    const baseConversation =
      previousConversation ?? this.createEmptyConversation(resolvedConversationId);
    const timestamp = this.dependencies.now();
    const effectiveResponseMode = conversationId === 'new'
      ? this.getResponseMode('new')
      : baseConversation.responseMode ?? this.getResponseMode(resolvedConversationId);
    const requestId = this.dependencies.createId('request');
    const originatingUserMessageId = this.dependencies.createId('user-message');
    const assistantMessageId = this.dependencies.createId('assistant-message');
    const updatedConversation: Conversation = {
      ...baseConversation,
      updatedAt: timestamp,
      status: 'streaming',
      errorMessage: null,
      messages: [
        ...baseConversation.messages,
        {
          id: originatingUserMessageId,
          role: 'user',
          text: request.question,
          attachments:
            request.imagePath === null ? [] : [{ kind: 'image', path: request.imagePath }],
          status: 'completed',
          errorMessage: null,
          createdAt: timestamp,
        },
        {
          id: assistantMessageId,
          role: 'assistant',
          text: '',
          attachments: [],
          status: 'generating',
          errorMessage: null,
          createdAt: timestamp + 1,
        },
      ],
      responseMode: effectiveResponseMode,
    };
    const activeGeneration: ActiveGeneration = {
      conversationId: resolvedConversationId,
      originatingUserMessageId,
      assistantMessageId,
      responseMode: effectiveResponseMode,
    };
    const inferenceRequest = this.createInferenceRequest(activeGeneration, request, requestId);
    const orchestration = this.dependencies.contextOrchestrator.orchestrate(
      createCanonicalConversationSnapshot(updatedConversation, originatingUserMessageId),
    );
    activeGeneration.contextDiagnostics = orchestration.diagnostics;
    const conversationWithMemory: Conversation = {
      ...updatedConversation,
      contextMemory: orchestration.memory,
    };

    this.dependencies.historyStore.save(conversationWithMemory);
    this.activeGeneration = activeGeneration;
    this.setRuntimeState({
      conversationId: resolvedConversationId,
      originatingUserMessageId,
      assistantMessageId,
      streamingText: '',
      isOwnerOfActiveInference: true,
    });

    this.startQueueSubmission(activeGeneration, inferenceRequest, orchestration.context);
    this.clearDraft(conversationId);
    return {
      conversationId: activeGeneration.conversationId,
      originatingUserMessageId: activeGeneration.originatingUserMessageId,
      assistantMessageId: activeGeneration.assistantMessageId,
    };
  }

  async retryFailedMessage(conversationId: string, assistantMessageId: string): Promise<void> {
    this.assertCanStartGeneration();

    const conversation = this.dependencies.historyStore.get(conversationId);
    if (conversation === null) {
      throw new Error(`Conversation ${conversationId} was not found.`);
    }

    const assistantIndex = conversation.messages.findIndex(
      (message) => message.id === assistantMessageId && message.role === 'assistant'
    );
    if (assistantIndex < 1) {
      throw new Error(`Assistant message ${assistantMessageId} was not found.`);
    }

    const assistantMessage = conversation.messages[assistantIndex];
    const userMessage = findPairedUserMessage(conversation.messages, assistantIndex);
    if (assistantMessage?.status !== 'failed' || userMessage === null) {
      throw new Error(`Assistant message ${assistantMessageId} cannot be retried.`);
    }

    const replacementAssistantMessageId = this.dependencies.createId('assistant-message');
    const activeGeneration: ActiveGeneration = {
      conversationId,
      originatingUserMessageId: userMessage.id,
      assistantMessageId: replacementAssistantMessageId,
      responseMode: conversation.responseMode ?? this.dependencies.getDefaultResponseMode(),
    };
    const requestId = this.dependencies.createId('request');
    const messages: ConversationMessage[] = [
      ...conversation.messages,
      {
        id: replacementAssistantMessageId,
        role: 'assistant',
        text: '',
        attachments: [],
        status: 'generating',
        errorMessage: null,
        createdAt: this.dependencies.now(),
      },
    ];
    const updatedConversationWithoutMemory: Conversation = {
      ...conversation,
      updatedAt: this.dependencies.now(),
      status: 'streaming',
      errorMessage: null,
      messages,
    };
    const orchestration = this.dependencies.contextOrchestrator.orchestrate(
      createCanonicalConversationSnapshot(updatedConversationWithoutMemory, userMessage.id),
    );
    activeGeneration.contextDiagnostics = orchestration.diagnostics;
    const updatedConversation: Conversation = {
      ...updatedConversationWithoutMemory,
      contextMemory: orchestration.memory,
    };

    this.dependencies.historyStore.save(updatedConversation);
    this.activeGeneration = activeGeneration;
    this.setRuntimeState({
      conversationId,
      originatingUserMessageId: userMessage.id,
      assistantMessageId: replacementAssistantMessageId,
      streamingText: '',
      isOwnerOfActiveInference: true,
    });

    this.startQueueSubmission(
      activeGeneration,
      this.createInferenceRequest(
        activeGeneration,
        {
          question: userMessage.text,
          imagePath: firstImagePath(userMessage),
        },
        requestId
      ),
      orchestration.context
    );
  }

  cancelActiveGeneration(conversationId: string): void {
    if (this.activeGeneration?.conversationId !== conversationId) {
      return;
    }

    this.dependencies.inferenceQueue.cancel();
  }

  isAnyGenerationInFlight(): boolean {
    return this.activeGeneration !== null;
  }

  getActiveGenerationOwner(): string | null {
    return this.activeGeneration?.conversationId ?? null;
  }

  getDraft(conversationId: string | 'new'): Draft {
    return this.drafts.get(conversationId) ?? createEmptyDraft(conversationId);
  }

  setDraftText(conversationId: string | 'new', text: string): void {
    const draft = this.getDraft(conversationId);
    this.drafts.set(conversationId, { ...draft, text });
  }

  setDraftImage(conversationId: string | 'new', imagePath: string | null): void {
    const draft = this.getDraft(conversationId);
    this.drafts.set(conversationId, { ...draft, imagePath });
  }

  clearDraft(conversationId: string | 'new'): void {
    this.drafts.set(conversationId, createEmptyDraft(conversationId));
  }

  startNewConversation(): void {
    this.clearDraft('new');
    this.responseModes.delete('new');
  }

  getResponseMode(conversationId: string | 'new'): ResponseMode {
    if (conversationId === 'new') {
      return this.responseModes.get('new') ?? this.dependencies.getDefaultResponseMode();
    }
    return this.responseModes.get(conversationId)
      ?? this.dependencies.historyStore.get(conversationId)?.responseMode
      ?? this.dependencies.getDefaultResponseMode();
  }

  setResponseMode(conversationId: string | 'new', mode: ResponseMode): void {
    this.responseModes.set(conversationId, mode);
    if (conversationId === 'new') {
      return;
    }
    this.dependencies.setPersistedResponseMode(conversationId, mode);
  }

  private handleInferenceState(state: InferenceState): void {
    const activeGeneration = this.activeGeneration;
    if (activeGeneration === null) {
      return;
    }

    if (isInProgressStatus(state.status)) {
      this.setRuntimeState({
        ...this.runtimeStateFor(activeGeneration),
        streamingText: state.response,
        isOwnerOfActiveInference: true,
      });
      return;
    }

    if (state.status === 'completed') {
      this.finishActiveGeneration(activeGeneration, state, 'completed');
      return;
    }

    if (state.status === 'errored') {
      this.finishActiveGeneration(activeGeneration, state, 'failed');
      return;
    }

    if (state.status === 'cancelled') {
      this.finishActiveGeneration(activeGeneration, state, 'interrupted');
    }
  }

  private finishActiveGeneration(
    activeGeneration: ActiveGeneration,
    state: InferenceState,
    messageStatus: Exclude<MessageStatus, 'generating'>
  ): void {
    const conversation = this.dependencies.historyStore.get(activeGeneration.conversationId);
    if (conversation !== null) {
      const errorMessage = state.status === 'errored' ? state.error ?? 'Inference failed.' : null;
      this.dependencies.historyStore.save({
        ...conversation,
        updatedAt: this.dependencies.now(),
        status: conversationStatusForMessageStatus(messageStatus),
        errorMessage,
        metrics: state.status === 'completed' ? state.metrics : conversation.metrics,
        contextMemory:
          state.status === 'completed' && state.hiddenEvidence != null
            ? mergeVisualEvidenceIntoMemory(
                conversation.contextMemory,
                state.hiddenEvidence,
                activeGeneration.originatingUserMessageId,
              )
            : conversation.contextMemory ?? null,
        messages: conversation.messages.map((message) =>
          message.id === activeGeneration.assistantMessageId
            ? {
                ...message,
                text: state.status === 'completed' ? state.response : message.text,
                status: messageStatus,
                errorMessage,
              }
            : message
        ),
      });
      if (state.status === 'completed' && state.hiddenEvidence != null) {
        this.dependencies.persistEvidence(
          activeGeneration.conversationId,
          activeGeneration.originatingUserMessageId,
          state.hiddenEvidence,
        );
      }
    }

    this.recordDiagnosticTurn(activeGeneration, state);
    this.activeGeneration = null;
    this.setRuntimeState(this.idleRuntimeState(activeGeneration, state.response));
  }

  private recordDiagnosticTurn(activeGeneration: ActiveGeneration, state: InferenceState): void {
    const trace = state.inferenceTrace;
    if (trace === null || trace === undefined || !isDevelopmentInferenceTraceEnabled()) {
      return;
    }

    diagnosticsTraceStore.append({
      id: trace.id,
      conversationId: activeGeneration.conversationId,
      originatingUserMessageId: activeGeneration.originatingUserMessageId,
      assistantMessageId: activeGeneration.assistantMessageId,
      capturedAt: this.dependencies.now(),
      trace,
      objectiveResult: state.objectiveResult ?? null,
      contextDiagnostics: activeGeneration.contextDiagnostics ?? null,
    });
  }

  private assertCanStartGeneration(): void {
    if (
      this.activeGeneration !== null ||
      isInProgressStatus(this.dependencies.inferenceQueue.getState().status)
    ) {
      throw new Error('An inference generation is already in flight.');
    }
  }

  private createEmptyConversation(conversationId: string): Conversation {
    const timestamp = this.dependencies.now();
    return {
      id: conversationId,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
      status: 'idle',
      errorMessage: null,
      metrics: null,
      flagged: false,
      flagNote: null,
      contextMemory: null,
      responseMode: this.dependencies.getDefaultResponseMode(),
    };
  }

  private createInferenceRequest(
    activeGeneration: ActiveGeneration,
    request: { question: string; imagePath: string | null },
    requestId: string
  ): InferenceRequest {
    return {
      requestId,
      conversationId: activeGeneration.conversationId,
      originatingUserMessageId: activeGeneration.originatingUserMessageId,
      assistantMessageId: activeGeneration.assistantMessageId,
      question: request.question,
      imagePath: request.imagePath,
    };
  }

  private startQueueSubmission(
    activeGeneration: ActiveGeneration,
    request: InferenceRequest,
    conversationContext: CanonicalConversationContext
  ): void {
    const options = {
      // Mirrors the legacy store's semantics: a turn with prior completed
      // context is a follow-up (model already resident); otherwise first.
      turn: hasSelectedConversationContext(conversationContext)
        ? ('followUp' as const)
        : ('first' as const),
      conversationContext,
      responseMode: activeGeneration.responseMode,
    };
    void this.dependencies.inferenceQueue.submit(request, options).catch((error: unknown) => {
      if (
        this.activeGeneration?.conversationId !== activeGeneration.conversationId ||
        this.activeGeneration.assistantMessageId !== activeGeneration.assistantMessageId
      ) {
        return;
      }

      this.finishActiveGeneration(
        activeGeneration,
        {
          status: 'errored',
          response: '',
          metrics: null,
          error: error instanceof Error ? error.message : 'Inference failed.',
          limitWarning: null,
          pinnedExtraction: null,
          hiddenEvidence: null,
          objectiveResult: null,
          inferenceTrace: null,
        },
        'failed'
      );
    });
  }

  private runtimeStateFor(activeGeneration: ActiveGeneration): ConversationRuntimeState {
    return (
      this.runtimeStates.get(activeGeneration.conversationId) ?? {
        conversationId: activeGeneration.conversationId,
        originatingUserMessageId: activeGeneration.originatingUserMessageId,
        assistantMessageId: activeGeneration.assistantMessageId,
        streamingText: '',
        isOwnerOfActiveInference: true,
      }
    );
  }

  private idleRuntimeState(
    activeGeneration: ActiveGeneration,
    streamingText = ''
  ): ConversationRuntimeState {
    return {
      conversationId: activeGeneration.conversationId,
      originatingUserMessageId: activeGeneration.originatingUserMessageId,
      assistantMessageId: activeGeneration.assistantMessageId,
      streamingText,
      isOwnerOfActiveInference: false,
    };
  }

  private setRuntimeState(state: ConversationRuntimeState): void {
    this.runtimeStates.set(state.conversationId, state);
    const listeners = this.listeners.get(state.conversationId);
    if (listeners === undefined) {
      return;
    }

    for (const listener of listeners) {
      listener(state);
    }
  }
}

export function createConversationStore(
  dependencies: ConversationStoreDependencies
): ConversationStore {
  return new ConversationStore({
    now: Date.now,
    createId: createStableId,
    contextOrchestrator: new ContextOrchestrator(),
    getDefaultResponseMode: () => DEFAULT_RESPONSE_MODE,
    setPersistedResponseMode: () => undefined,
    persistEvidence: () => undefined,
    ...dependencies,
  });
}

export const conversationStore: IConversationStore = createConversationStore({
  inferenceQueue,
  historyStore,
  getDefaultResponseMode: () => useSettingsStore.getState().defaultResponseMode,
  setPersistedResponseMode: (conversationId, mode) => {
    conversationRepository.setResponseMode(conversationId, toStoredMode(mode));
    useHistoryStore.getState().refresh();
  },
  persistEvidence: (conversationId, sourceMessageId, evidence) => {
    const asset = imageRepository.getAssetsForMessage(sourceMessageId)[0];
    if (asset === undefined) {
      return;
    }
    evidenceRepository.saveEvidence({
      conversationId,
      sourceMessageId,
      imageAssetId: asset.id,
      evidence,
      sourceRevision: `${evidence.version}:${asset.content_hash ?? asset.local_path}`,
    });
  },
});

function createEmptyDraft(conversationId: string | 'new'): Draft {
  return {
    conversationId: conversationId === 'new' ? null : conversationId,
    text: '',
    imagePath: null,
  };
}

function findPairedUserMessage(
  messages: ConversationMessage[],
  assistantIndex: number
): ConversationMessage | null {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message;
    }
  }

  return null;
}

function firstImagePath(message: ConversationMessage): string | null {
  return message.attachments.find((attachment) => attachment.kind === 'image')?.path ?? null;
}

function isInProgressStatus(status: InferenceState['status']): boolean {
  return status === 'preprocessing' || status === 'loading_model' || status === 'streaming';
}

function conversationStatusForMessageStatus(
  status: Exclude<MessageStatus, 'generating'>
): Conversation['status'] {
  if (status === 'completed') {
    return 'completed';
  }

  if (status === 'interrupted') {
    return 'cancelled';
  }

  return 'errored';
}

function createStableId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hasSelectedConversationContext(context: CanonicalConversationContext): boolean {
  return (
    context.recentTurns.length > 0 ||
    context.mediaEvidence.length > 0 ||
    context.importantFacts.length > 0 ||
    context.olderSummary !== null
  );
}
