import { buildContextTurnsBeforeMessage, type ContextTurn } from '../inference/ContextBuilder';
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

import { historyStore } from './historyStore';
import { inferenceQueue } from './inferenceStore';

export interface ConversationStoreDependencies {
  inferenceQueue: IInferenceQueue;
  historyStore: IHistoryStore;
  now?: () => number;
  createId?: (prefix: string) => string;
}

interface ActiveGeneration {
  conversationId: string;
  originatingUserMessageId: string;
  assistantMessageId: string;
}

interface SubmitResult {
  conversationId: string;
  originatingUserMessageId: string;
  assistantMessageId: string;
}

export class ConversationStore implements IConversationStore {
  private readonly runtimeStates = new Map<string, ConversationRuntimeState>();
  private readonly drafts = new Map<string, Draft>();
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
    };
    const activeGeneration: ActiveGeneration = {
      conversationId: resolvedConversationId,
      originatingUserMessageId,
      assistantMessageId,
    };
    const inferenceRequest = this.createInferenceRequest(activeGeneration, request, requestId);
    // FR-009/FR-011: bounded prior canonical turns from THIS conversation only —
    // the queue assembles them into the model request via ContextBuilder.
    const canonicalTurns = buildContextTurnsBeforeMessage(
      updatedConversation.messages,
      originatingUserMessageId
    );

    this.dependencies.historyStore.save(updatedConversation);
    this.activeGeneration = activeGeneration;
    this.setRuntimeState({
      conversationId: resolvedConversationId,
      originatingUserMessageId,
      assistantMessageId,
      streamingText: '',
      isOwnerOfActiveInference: true,
    });

    this.startQueueSubmission(activeGeneration, inferenceRequest, canonicalTurns);
    this.clearDraft(conversationId);
    return activeGeneration;
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

    const activeGeneration: ActiveGeneration = {
      conversationId,
      originatingUserMessageId: userMessage.id,
      assistantMessageId,
    };
    const requestId = this.dependencies.createId('request');
    const messages = conversation.messages.map((message) =>
      message.id === assistantMessageId
        ? {
            ...message,
            text: '',
            status: 'generating' as MessageStatus,
            errorMessage: null,
          }
        : message
    );
    const updatedConversation: Conversation = {
      ...conversation,
      updatedAt: this.dependencies.now(),
      status: 'streaming',
      errorMessage: null,
      messages,
    };

    this.dependencies.historyStore.save(updatedConversation);
    this.activeGeneration = activeGeneration;
    this.setRuntimeState({
      conversationId,
      originatingUserMessageId: userMessage.id,
      assistantMessageId,
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
      buildContextTurnsBeforeMessage(messages, userMessage.id)
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
    }

    this.activeGeneration = null;
    this.setRuntimeState(this.idleRuntimeState(activeGeneration, state.response));
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
    canonicalTurns: ContextTurn[]
  ): void {
    const options = {
      // Mirrors the legacy store's semantics: a turn with prior completed
      // context is a follow-up (model already resident); otherwise first.
      turn: canonicalTurns.length > 0 ? ('followUp' as const) : ('first' as const),
      canonicalTurns,
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
    ...dependencies,
  });
}

export const conversationStore: IConversationStore = createConversationStore({
  inferenceQueue,
  historyStore,
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
