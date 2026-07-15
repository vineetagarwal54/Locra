import { diagnosticsTraceStore } from '../diagnostics/DiagnosticsTraceStore';
import {
  CompactionService,
  createRegisteredEngineCompactionGenerator,
  CURRENT_SUMMARIZER_VERSION,
} from '../inference/CompactionService';
import {
  type CanonicalConversationContext,
} from '../inference/ContextBuilder';
import {
  CharacterContextBudgetPolicy,
  ContextOrchestrator,
  createCanonicalConversationSnapshot,
  mergeVisualEvidenceIntoMemory,
  type ContextSelectionDiagnostics,
} from '../inference/ContextOrchestrator';
import { inferenceQueue } from '../inference/InferenceService';
import { isDevelopmentInferenceTraceEnabled } from '../inference/InferenceTrace';
import type { HiddenVisualEvidence } from '../inference/OutputPipelineTypes';
import { DEFAULT_RESPONSE_MODE, type ResponseMode, toStoredMode } from '../inference/ResponseMode';
import { durableImageStorage } from '../media/DurableImageStorage';
import { ChunkingService } from '../retrieval/ChunkingService';
import {
  ConversationTargetResolver,
  type ConversationCandidate,
} from '../retrieval/ConversationTargetResolver';
import { HybridRetriever } from '../retrieval/HybridRetriever';
import { LexicalFallbackRetriever } from '../retrieval/LexicalFallbackRetriever';
import type { RetrievalCandidate } from '../retrieval/types';
import type { IConversationStore, IHistoryStore, IInferenceQueue } from '../types/interfaces';
import type {
  BenchmarkKind,
  Conversation,
  ConversationMessage,
  ConversationRuntimeState,
  Draft,
  InferenceRequest,
  InferenceState,
  MessageStatus,
  PerformanceMetrics,
} from '../types/models';

import {
  benchmarkRepository,
  chunkRepository,
  conversationRepository,
  embeddingRepository,
  evidenceRepository,
  factRepository,
  historyStore,
  imageRepository,
  messageRepository,
  summaryRepository,
  useHistoryStore,
} from './historyStore';
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
  persistRetrievalUnits?: (conversationId: string, messageIds: readonly string[]) => void;
  scheduleCompaction?: (conversationId: string) => void;
  /** Records the timing of a completed attempt for the user-facing Benchmarks screen. */
  recordBenchmark?: (input: {
    conversationId: string;
    assistantMessageId: string;
    kind: BenchmarkKind;
    metrics: PerformanceMetrics;
  }) => void;
  targetResolver?: Pick<ConversationTargetResolver, 'resolve'>;
  checkpointAssistantText?: (assistantMessageId: string, text: string) => void;
  persistImage?: (conversationId: string, sourcePath: string) => Promise<string>;
}

interface ActiveGeneration {
  conversationId: string;
  originatingUserMessageId: string;
  assistantMessageId: string;
  contextDiagnostics?: ContextSelectionDiagnostics;
  responseMode: ResponseMode;
  lastObservedText: string;
  lastCheckpointText: string;
  lastCheckpointAt: number;
}

const STREAM_CHECKPOINT_INTERVAL_MS = 1000;

interface SubmitResult {
  conversationId: string;
  originatingUserMessageId: string;
  assistantMessageId: string;
  targetNotice?: string;
}

export class ConversationStore implements IConversationStore {
  private readonly runtimeStates = new Map<string, ConversationRuntimeState>();
  private readonly drafts = new Map<string, Draft>();
  private readonly responseModes = new Map<string, ResponseMode>();
  // When a past-chat reference is ambiguous we ask which one and remember the
  // bounded candidates so the NEXT message in that chat can resolve the pick.
  private readonly pendingTargets = new Map<string, readonly ConversationCandidate[]>();
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
    request: { question: string; imagePath: string | null; conversationTargetId?: string }
  ): Promise<SubmitResult> {
    this.assertCanStartGeneration();

    const resolvedConversationId =
      conversationId === 'new' ? this.dependencies.createId('conversation') : conversationId;
    const durableImagePath = request.imagePath === null
      ? null
      : await this.dependencies.persistImage(resolvedConversationId, request.imagePath);
    const durableRequest = { ...request, imagePath: durableImagePath };

    // Cross-chat targeting is request-scoped only and is NEVER merged permanently
    // into this chat's summaries/facts/image state. An ambiguous reference posts a
    // clarification turn instead of generating.
    const targetOutcome = this.resolveConversationTarget(resolvedConversationId, durableRequest);
    if (targetOutcome.kind === 'clarify') {
      return this.injectTargetClarification(
        conversationId,
        resolvedConversationId,
        durableRequest,
        targetOutcome.candidates,
      );
    }
    const selectedConversationId = targetOutcome.selectedConversationId;
    const targetNotice = targetOutcome.notice;

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
          text: durableRequest.question,
          attachments:
            durableRequest.imagePath === null ? [] : [{ kind: 'image', path: durableRequest.imagePath }],
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
      lastObservedText: '',
      lastCheckpointText: '',
      lastCheckpointAt: 0,
    };
    const inferenceRequest = this.createInferenceRequest(activeGeneration, durableRequest, requestId);
    const orchestration = this.dependencies.contextOrchestrator.orchestrate(
      createCanonicalConversationSnapshot(updatedConversation, originatingUserMessageId),
      { responseMode: effectiveResponseMode, selectedConversationId },
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
      ...(targetNotice === undefined ? {} : { targetNotice }),
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
    if (
      (assistantMessage?.status !== 'failed' && assistantMessage?.status !== 'interrupted') ||
      userMessage === null
    ) {
      throw new Error(`Assistant message ${assistantMessageId} cannot be retried.`);
    }

    const replacementAssistantMessageId = this.dependencies.createId('assistant-message');
    const activeGeneration: ActiveGeneration = {
      conversationId,
      originatingUserMessageId: userMessage.id,
      assistantMessageId: replacementAssistantMessageId,
      responseMode: conversation.responseMode ?? this.dependencies.getDefaultResponseMode(),
      lastObservedText: assistantMessage.text,
      lastCheckpointText: assistantMessage.text,
      lastCheckpointAt: this.dependencies.now(),
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
      { responseMode: activeGeneration.responseMode },
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

  private resolveConversationTarget(
    resolvedConversationId: string,
    request: { question: string; conversationTargetId?: string },
  ):
    | { kind: 'scope'; selectedConversationId?: string; notice?: string }
    | { kind: 'clarify'; candidates: readonly ConversationCandidate[] } {
    // If we previously asked which past chat, try to resolve this reply to a pick.
    const pending = this.pendingTargets.get(resolvedConversationId);
    if (pending !== undefined) {
      this.pendingTargets.delete(resolvedConversationId);
      const picked = pickPendingCandidate(pending, request.question);
      if (picked !== null) {
        return { kind: 'scope', selectedConversationId: picked.id };
      }
    }

    const target = this.dependencies.targetResolver.resolve({
      rawText: request.question,
      activeConversationId: resolvedConversationId,
      ...(request.conversationTargetId === undefined
        ? {}
        : { selectedId: request.conversationTargetId }),
    });
    if (target.kind === 'ambiguous') {
      return { kind: 'clarify', candidates: target.candidates };
    }
    if (target.kind === 'not-found') {
      return {
        kind: 'scope',
        notice: 'The chat you referred to is no longer available. Continuing without it.',
      };
    }
    if (target.kind === 'scoped') {
      return { kind: 'scope', selectedConversationId: target.conversationId };
    }
    return { kind: 'scope' };
  }

  /**
   * Posts a normal completed assistant turn asking which past chat the user meant,
   * without running the model, and remembers the candidates for the next reply.
   */
  private injectTargetClarification(
    conversationId: string | 'new',
    resolvedConversationId: string,
    request: { question: string; imagePath: string | null },
    candidates: readonly ConversationCandidate[],
  ): SubmitResult {
    const timestamp = this.dependencies.now();
    const baseConversation =
      this.dependencies.historyStore.get(resolvedConversationId)
      ?? this.createEmptyConversation(resolvedConversationId);
    const originatingUserMessageId = this.dependencies.createId('user-message');
    const assistantMessageId = this.dependencies.createId('assistant-message');
    const updatedConversation: Conversation = {
      ...baseConversation,
      updatedAt: timestamp,
      status: 'completed',
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
          text: buildTargetClarification(candidates),
          attachments: [],
          status: 'completed',
          errorMessage: null,
          createdAt: timestamp + 1,
        },
      ],
    };

    this.dependencies.historyStore.save(updatedConversation);
    this.pendingTargets.set(resolvedConversationId, candidates);
    this.clearDraft(conversationId);
    return {
      conversationId: resolvedConversationId,
      originatingUserMessageId,
      assistantMessageId,
    };
  }

  private handleInferenceState(state: InferenceState): void {
    const activeGeneration = this.activeGeneration;
    if (activeGeneration === null) {
      return;
    }

    if (isInProgressStatus(state.status)) {
      if (state.response !== '') {
        activeGeneration.lastObservedText = state.response;
      }
      this.checkpointIfDue(activeGeneration, activeGeneration.lastObservedText);
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
    if (state.response !== '') {
      activeGeneration.lastObservedText = state.response;
    }
    this.flushCheckpoint(activeGeneration, activeGeneration.lastObservedText);
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
                text:
                  state.status === 'completed'
                    ? (state.response !== '' ? state.response : activeGeneration.lastObservedText)
                    : activeGeneration.lastObservedText || message.text,
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
      if (state.status === 'completed') {
        this.dependencies.persistRetrievalUnits(activeGeneration.conversationId, [
          activeGeneration.originatingUserMessageId,
          activeGeneration.assistantMessageId,
        ]);
        this.dependencies.scheduleCompaction(activeGeneration.conversationId);
        if (state.metrics !== null) {
          // Only completed attempts are benchmarked — failed/interrupted/cancelled
          // never reach this branch, so no bad run is ever recorded.
          const userMessage = conversation.messages.find(
            (message) => message.id === activeGeneration.originatingUserMessageId,
          );
          const kind: BenchmarkKind = userMessage?.attachments.some(
            (attachment) => attachment.kind === 'image',
          )
            ? 'image'
            : 'text';
          this.dependencies.recordBenchmark({
            conversationId: activeGeneration.conversationId,
            assistantMessageId: activeGeneration.assistantMessageId,
            kind,
            metrics: state.metrics,
          });
        }
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

  private checkpointIfDue(activeGeneration: ActiveGeneration, text: string): void {
    if (text === activeGeneration.lastCheckpointText) {
      return;
    }
    const now = this.dependencies.now();
    if (now - activeGeneration.lastCheckpointAt < STREAM_CHECKPOINT_INTERVAL_MS) {
      return;
    }
    this.dependencies.checkpointAssistantText(activeGeneration.assistantMessageId, text);
    activeGeneration.lastCheckpointText = text;
    activeGeneration.lastCheckpointAt = now;
  }

  private flushCheckpoint(activeGeneration: ActiveGeneration, text: string): void {
    if (text === activeGeneration.lastCheckpointText) {
      return;
    }
    this.dependencies.checkpointAssistantText(activeGeneration.assistantMessageId, text);
    activeGeneration.lastCheckpointText = text;
    activeGeneration.lastCheckpointAt = this.dependencies.now();
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
    persistRetrievalUnits: () => undefined,
    scheduleCompaction: () => undefined,
    recordBenchmark: () => undefined,
    checkpointAssistantText: () => undefined,
    persistImage: async (_conversationId, sourcePath) => sourcePath,
    targetResolver: { resolve: () => ({ kind: 'active' }) },
    ...dependencies,
  });
}

function createRuntimeContextOrchestrator(): ContextOrchestrator {
  const lexicalFallback = new LexicalFallbackRetriever();
  return new ContextOrchestrator(new CharacterContextBudgetPolicy(), {
    retriever: new HybridRetriever(embeddingRepository, lexicalFallback),
    evidenceRepository,
    listLexicalCandidates: listLexicalCandidates,
    listDurableFacts: (conversationId) => factRepository.getReadyFacts(conversationId).map((fact) => ({
      version: 'context-memory-fact-v1',
      id: fact.id,
      sourceMessageId: factRepository.getSourceMessageIds(fact.id)[0] ?? fact.id,
      text: fact.value_text,
      createdAt: fact.updated_at,
    })),
    getNewestReadySummary: (conversationId) =>
      summaryRepository.getNewestReady(conversationId, CURRENT_SUMMARIZER_VERSION)?.text ?? null,
    // The approved embedding manifest is intentionally absent until T005 passes.
  });
}

function listLexicalCandidates(conversationIds: readonly string[]): RetrievalCandidate[] {
  const chunks = chunkRepository.listRetrievalSourceUnits(conversationIds);
  const evidence = conversationIds.flatMap((conversationId) =>
    evidenceRepository.listRetrievalSourceUnits(conversationId).map((unit) => ({
      id: unit.id,
      sourceConversationId: unit.conversationId,
      sourceMessageId: unit.sourceMessageId,
      imageAssetId: unit.imageAssetId,
      timestamp: unit.timestamp,
      contentType: 'evidence' as const,
      text: unit.text,
    })),
  );
  return [...chunks, ...evidence];
}

export const conversationStore: IConversationStore = createConversationStore({
  inferenceQueue,
  historyStore,
  persistImage: (conversationId, sourcePath) => durableImageStorage.persist(conversationId, sourcePath),
  contextOrchestrator: createRuntimeContextOrchestrator(),
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
  persistRetrievalUnits: (_conversationId, messageIds) => {
    const chunker = new ChunkingService('chunk-v1');
    for (const messageId of messageIds) {
      const row = messageRepository.getMessage(messageId);
      if (row === null || (row.role === 'assistant' && row.status !== 'completed')) {
        continue;
      }
      chunkRepository.upsertChunksForMessage(row.id, 'chunk-v1', chunker.chunk({
        id: row.id,
        conversationId: row.conversation_id,
        text: row.text,
        sourceRevision: `${row.status}:${row.created_at}:${row.text.length}`,
        createdAt: row.created_at,
      }));
    }
  },
  scheduleCompaction: (conversationId) => {
    setTimeout(() => {
      void runtimeCompactionService.maybeRun(conversationId).catch(() => undefined);
    }, 0);
  },
  recordBenchmark: ({ conversationId, assistantMessageId, kind, metrics }) => {
    benchmarkRepository.record({ conversationId, messageId: assistantMessageId, kind, metrics });
  },
  checkpointAssistantText: (assistantMessageId, text) => {
    messageRepository.updateAssistantStreamingText(assistantMessageId, text);
  },
  targetResolver: new ConversationTargetResolver(conversationRepository),
});

const runtimeCompactionService = new CompactionService({
  messages: messageRepository,
  summaries: summaryRepository,
  facts: factRepository,
  generator: createRegisteredEngineCompactionGenerator(),
});

const ORDINAL_WORDS: Readonly<Record<string, number>> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
};

/** Formats the "which past chat did you mean?" turn from bounded candidates. */
function buildTargetClarification(candidates: readonly ConversationCandidate[]): string {
  const list = candidates
    .map((candidate, index) => `${index + 1}. ${candidateTitle(candidate)}`)
    .join('\n');
  return (
    'You have a few past conversations that could match:\n\n' +
    `${list}\n\n` +
    "Reply with the number or name of the one you'd like me to use, and I'll pull " +
    'context from it for your next message.'
  );
}

/** Resolves a clarification reply to one remembered candidate, or null if unclear. */
function pickPendingCandidate(
  candidates: readonly ConversationCandidate[],
  reply: string,
): ConversationCandidate | null {
  const normalized = reply.toLowerCase().trim();

  const explicitIndex = readCandidateIndex(normalized);
  if (explicitIndex !== null && explicitIndex >= 0 && explicitIndex < candidates.length) {
    return candidates[explicitIndex];
  }

  const byTitle = candidates.filter((candidate) => {
    const tokens = titleTokens(candidate.title);
    return tokens.length > 0 && tokens.every((token) => normalized.includes(token));
  });
  return byTitle.length === 1 ? byTitle[0] : null;
}

/** Reads a 1-based selection ("2", "option 2", "the second one") as a 0-based index. */
function readCandidateIndex(normalized: string): number | null {
  for (const [word, value] of Object.entries(ORDINAL_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) {
      return value - 1;
    }
  }
  const explicit = normalized.match(/^(?:option|number|chat|#)?\s*([1-9])\b/);
  if (explicit !== null) {
    return Number(explicit[1]) - 1;
  }
  return null;
}

function candidateTitle(candidate: ConversationCandidate): string {
  const trimmed = candidate.title?.trim();
  return trimmed === undefined || trimmed === '' ? 'Untitled chat' : trimmed;
}

function titleTokens(title: string | null | undefined): string[] {
  const stopWords = new Set(['the', 'and', 'for', 'chat', 'notes', 'plan', 'plans']);
  return (title ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

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
  return (
    status === 'preprocessing' ||
    status === 'loading_model' ||
    status === 'streaming' ||
    // A stop is settling: still in-flight, so no new generation may start and the
    // owning conversation stays locked until the terminal 'cancelled' arrives.
    status === 'cancelling'
  );
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
