import {
  diagnosticsTraceStore,
  type DiagnosticRequestKind,
  type ProductionConversationFocusSummary,
  type ProductionDiagnosticTurnSummary,
} from '../diagnostics/DiagnosticsTraceStore';
import {
  createTurnArchitectureDiagnostics,
  withTerminalVisionEvidenceDiagnostic,
  withControlledExecutionDiagnostic,
  type TurnArchitectureDiagnostics,
} from '../diagnostics/TurnArchitectureDiagnostics';
import {
  CompactionService,
  createRegisteredEngineCompactionGenerator,
  CURRENT_SUMMARIZER_VERSION,
} from '../inference/CompactionService';
import {
  type CanonicalConversationContext,
} from '../inference/ContextBuilder';
import {
  ContextOrchestrator,
  TokenContextBudgetPolicy,
  createCanonicalConversationSnapshot,
  mergeVisualEvidenceIntoMemory,
  type ContextSelectionDiagnostics,
  type ImageSelectionResult,
} from '../inference/ContextOrchestrator';
import {
  assemblePlannedTurnContext,
} from '../inference/ControlledImageContextAssembler';
import {
  ControlledImageTurnExecutor,
} from '../inference/ControlledImageTurnExecutor';
import {
  CURRENT_GENERATION_CONFIG_ID,
  CURRENT_PIPELINE_VARIANT_ID,
  createGenerationPlan,
  createGenerationPlanFromTurnPlan,
  samplingProfileForRequestKind,
  type GenerationPlan,
} from '../inference/GenerationTuning';
import {
  assessGroundingFromSources,
  createGroundingSourceSet,
} from '../inference/GroundingAssessment';
import {
  recoverIndependentRoutingSources,
  type IndependentRecoveryCandidate,
} from '../inference/IndependentRoutingRecovery';
import {
  applyImageSelectionToInferenceRequest,
  inferenceQueue,
} from '../inference/InferenceService';
import { isDevelopmentInferenceTraceEnabled } from '../inference/InferenceTrace';
import type { HiddenVisualEvidence } from '../inference/OutputPipelineTypes';
import { classifyRequest } from '../inference/RequestClassifier';
import {
  DEFAULT_RESPONSE_MODE,
  getResponseModeConfig,
  type ResponseMode,
  toStoredMode,
} from '../inference/ResponseMode';
import {
  buildRuntimeIndependentRecoveryCandidates,
} from '../inference/RuntimeIndependentRecoveryCandidates';
import {
  normalizeHiddenVisualEvidence,
} from '../inference/StructuredVisualExtraction';
import {
  VisionExecutor,
  type VisionExecutionResult,
} from '../inference/VisionExecutor';
import { durableImageStorage } from '../media/DurableImageStorage';
import {
  emptyConversationFocusLedger,
  deriveConversationFocusLedger,
  toConversationFocusPlannerInput,
  type ConversationFocusLedger,
} from '../memory/ConversationStateLedger';
import type { ControlledPlanningImage } from '../planning/ControlledImageTurnPlanner';
import {
  DEFAULT_PLANNER_ACTIVATION,
  plannerActivationForRuntime,
  resolvePlannerActivation,
  type PlannerActivationConfig,
} from '../planning/PlannerActivation';
import { TurnPlanner } from '../planning/TurnPlanner';
import type { TurnPlan } from '../planning/types';
import {
  planUniversalTurn,
  type UniversalTurnAction,
  type UniversalTurnPlanningResult,
} from '../planning/UniversalTurnPlanner';
import { ChunkingService } from '../retrieval/ChunkingService';
import type { EmbeddingService } from '../retrieval/EmbeddingService';
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
  GenerationFinishReason,
  InferenceRequest,
  InferenceEvidenceState,
  InferenceExecutionDiagnostics,
  InferenceState,
  MessageStatus,
  PerformanceMetrics,
} from '../types/models';

import {
  benchmarkRepository,
  chunkRepository,
  conversationRepository,
  conversationStateLedgerRepository,
  embeddingRepository,
  evidenceRepository,
  factRepository,
  historyStore,
  imageEntityRepository,
  imageRepository,
  messageRepository,
  summaryRepository,
  structuredImageEvidenceRepository,
  useHistoryStore,
} from './historyStore';
import { useSettingsStore } from './settingsStore';

export interface ConversationStoreDependencies {
  inferenceQueue: IInferenceQueue;
  historyStore: IHistoryStore;
  contextOrchestrator?: ContextOrchestrator;
  embeddingService?: Pick<EmbeddingService, 'embed'>;
  isEmbeddingRuntimeActive?: () => boolean;
  getCrossChatOptions?: (conversationId: string) => {
    readonly enabled: boolean;
    readonly currentConversationExcluded: boolean;
    readonly eligibleConversationIds: readonly string[];
  };
  now?: () => number;
  createId?: (prefix: string) => string;
  getDefaultResponseMode?: () => ResponseMode;
  setPersistedResponseMode?: (conversationId: string, mode: ResponseMode) => void;
  persistEvidence?: (
    conversationId: string,
    sourceMessageId: string,
    evidence: HiddenVisualEvidence,
    target?: { readonly imageAssetId: string; readonly reinferred: true },
  ) => void;
  persistRetrievalUnits?: (conversationId: string, messageIds: readonly string[]) => void;
  scheduleCompaction?: (conversationId: string) => void;
  /** Records the timing of a completed attempt for the user-facing Benchmarks screen. */
  recordBenchmark?: (input: {
    conversationId: string;
    assistantMessageId: string;
    kind: BenchmarkKind;
    metrics: PerformanceMetrics;
  }) => void;
  checkpointAssistantText?: (assistantMessageId: string, text: string) => void;
  persistImage?: (conversationId: string, sourcePath: string) => Promise<string>;
  plannerActivation?: PlannerActivationConfig;
  turnPlanner?: TurnPlanner;
  listIndependentRecoveryCandidates?: (
    snapshot: import('../types/models').CanonicalConversationSnapshot,
    options?: import('../inference/RuntimeIndependentRecoveryCandidates')
      .RuntimeRecoveryCandidateOptions,
  ) => readonly IndependentRecoveryCandidate[];
  listControlledPlanningImages?: (
    conversationId: string,
  ) => readonly ControlledPlanningImage[];
  visionExecutor?: VisionExecutor;
  getConversationFocusLedger?: (conversationId: string) => ConversationFocusLedger;
  publishConversationFocusLedger?: (conversationId: string) => ConversationFocusLedger;
}

interface ActiveGeneration {
  conversationId: string;
  originatingUserMessageId: string;
  assistantMessageId: string;
  contextDiagnostics?: ContextSelectionDiagnostics;
  architectureDiagnostics?: TurnArchitectureDiagnostics;
  selectedContext?: CanonicalConversationContext;
  responseMode: ResponseMode;
  softTargetTokens?: number;
  generationPlan?: GenerationPlan;
  requestKind: DiagnosticRequestKind;
  imageSupplied: boolean;
  reinferenceImageAssetId?: string;
  evidencePersistence?: {
    readonly durationMs: number;
    readonly completed: boolean;
  };
  lastObservedText: string;
  lastCheckpointText: string;
  lastCheckpointAt: number;
  /**
   * Non-empty only for a continuation: the already-shown truncated text that the
   * new attempt continues from. It is prepended to everything the engine streams
   * so the visible/persisted answer is seamless while the model never re-emits it.
   */
  seedText: string;
  focusLedgerBefore: ConversationFocusLedger;
  focusLedger: ConversationFocusLedger;
  focusLedgerPublicationStatus: 'current' | 'updated' | 'rebuild-required';
}

const STREAM_CHECKPOINT_INTERVAL_MS = 1000;

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
    const durableImagePath = request.imagePath === null
      ? null
      : await this.dependencies.persistImage(resolvedConversationId, request.imagePath);
    const durableRequest = { ...request, imagePath: durableImagePath };

    const previousConversation = this.dependencies.historyStore.get(resolvedConversationId);
    const baseConversation =
      previousConversation ?? this.createEmptyConversation(resolvedConversationId);
    const focusLedger =
      this.dependencies.getConversationFocusLedger(resolvedConversationId);
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
      requestKind: durableRequest.imagePath === null ? 'text' : 'image',
      imageSupplied: durableRequest.imagePath !== null,
      lastObservedText: '',
      lastCheckpointText: '',
      lastCheckpointAt: 0,
      seedText: '',
      focusLedgerBefore: focusLedger,
      focusLedger,
      focusLedgerPublicationStatus: 'current',
    };
    let planningConversation = updatedConversation;
    if (durableRequest.imagePath !== null) {
      // Image identity is durable before planning or extraction. Evidence is a
      // later, independently validated record and may legitimately remain absent.
      this.dependencies.historyStore.save(updatedConversation);
      planningConversation =
        this.dependencies.historyStore.get(resolvedConversationId) ?? updatedConversation;
    }
    // Canonical persistence precedes universal planning so attached image
    // identities and message relationships use durable IDs.
    this.dependencies.historyStore.save(planningConversation);
    planningConversation =
      this.dependencies.historyStore.get(resolvedConversationId) ?? planningConversation;
    const planningImages =
      this.dependencies.listControlledPlanningImages(resolvedConversationId);
    const snapshot = createCanonicalConversationSnapshot(
      planningConversation,
      originatingUserMessageId,
    );
    const universalPlanning = planUniversalTurn({
      snapshot,
      activation: this.dependencies.plannerActivation,
      images: planningImages,
      focusLedger: toConversationFocusPlannerInput(focusLedger),
      action: 'submit',
      planner: this.dependencies.turnPlanner,
    });
    const activation = resolvePlannerActivation(
      this.dependencies.plannerActivation,
      universalPlanning.planning.plan.scenarioClass,
    );
    if (!activation.useLegacySemantics) {
      return this.startPlannedTurn({
        activeGeneration,
        conversation: planningConversation,
        request: durableRequest,
        requestId,
        snapshot,
        planning: universalPlanning,
        draftConversationId: conversationId,
      });
    }

    // Explicit whole-turn rollback boundary. All obsolete legacy semantic
    // routing is contained below this branch and is unreachable otherwise.
    const recoveryCandidates = this.dependencies.listIndependentRecoveryCandidates(
      snapshot,
      {
        imageEntities: planningImages.map((image) => image.entity),
        entityAliases: planningImages.map((image) => ({
          id: image.entity.id,
          sourceMessageId: image.entity.sourceMessageId,
          aliases: image.aliases,
        })),
        activeComparisonImageIds: focusImageIds(focusLedger),
      },
    );
    const crossChat = this.dependencies.getCrossChatOptions(resolvedConversationId);
    const queryVector = await this.resolveEligibleQueryVector(
      snapshot,
      effectiveResponseMode,
      crossChat,
    );
    const orchestration = this.dependencies.contextOrchestrator.orchestrate(
      snapshot,
      {
        responseMode: effectiveResponseMode,
        diagnosticsEnabled: true,
        queryVector,
        crossChat,
        independentRecovery: {
          enabled: this.dependencies.plannerActivation.independentRecoveryEnabled,
          candidates: recoveryCandidates,
        },
      },
    );
    activeGeneration.architectureDiagnostics = createTurnArchitectureDiagnostics({
      activation,
      planning: universalPlanning.planning,
      recovery: {
        enabled: this.dependencies.plannerActivation.independentRecoveryEnabled,
        classifiedIndependent: false,
        considered: recoveryCandidates.length,
        recovered: recoveryCandidates,
      },
      scenarioClass: universalPlanning.planning.plan.scenarioClass,
      legacySemanticDecisionCount: 1,
    });
    const inferenceRequest = this.applyImageSelection(
      activeGeneration,
      this.createInferenceRequest(activeGeneration, durableRequest, requestId),
      orchestration.imageSelection,
    );
    const generationPlan = createGenerationPlan(
      effectiveResponseMode,
      durableRequest.question,
      orchestration.diagnostics?.classification ??
        classifyRequest(snapshot, effectiveResponseMode, {
          enabled: crossChat.enabled,
          conversationExcluded: crossChat.currentConversationExcluded,
        }),
      orchestration.contextNeedProfile.activeImageEvidence ||
        orchestration.contextNeedProfile.olderImageEvidence
        ? 'image'
        : 'text',
    );
    activeGeneration.generationPlan = generationPlan;
    activeGeneration.softTargetTokens = generationPlan.softTargetTokens;
    inferenceRequest.softTargetTokens = activeGeneration.softTargetTokens;
    inferenceRequest.hardSafetyLimitTokens = generationPlan.hardSafetyLimitTokens;
    inferenceRequest.gracefulCompletionReserveTokens =
      generationPlan.gracefulCompletionReserveTokens;
    inferenceRequest.generationPlanId = generationPlan.diagnosticsId;
    inferenceRequest.generationTaskKind = generationPlan.taskKind;
    inferenceRequest.loopDetectionEligible = generationPlan.loopDetectionEligible;
    activeGeneration.contextDiagnostics = orchestration.diagnostics;
    activeGeneration.selectedContext = orchestration.context;
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

  private async startPlannedTurn(input: {
    readonly activeGeneration: ActiveGeneration;
    readonly conversation: Conversation;
    readonly request: { readonly question: string; readonly imagePath: string | null };
    readonly requestId: string;
    readonly snapshot: ReturnType<typeof createCanonicalConversationSnapshot>;
    readonly planning: UniversalTurnPlanningResult;
    readonly draftConversationId: string | 'new';
  }): Promise<SubmitResult> {
    const plan = input.planning.planning.plan;
    const activation = resolvePlannerActivation(
      this.dependencies.plannerActivation,
      plan.scenarioClass,
    );
    const recovery = recoverIndependentRoutingSources({
      enabled: false,
      classifiedIndependent: false,
      candidates: [],
    });
    input.activeGeneration.architectureDiagnostics = createTurnArchitectureDiagnostics({
      activation,
      planning: input.planning.planning,
      recovery: {
        ...recovery,
        considered: 0,
        recovered: [],
      },
      scenarioClass: plan.scenarioClass,
      legacySemanticDecisionCount: 0,
    });

    const selectedImages = plan.vision.imageReferenceIds.map((imageId) =>
      input.planning.orderedImages.find((image) => image.entity.id === imageId),
    ).filter((image): image is ControlledPlanningImage => image !== undefined);
    const context = assemblePlannedTurnContext(
      plan,
      input.snapshot,
      selectedImages.map((image) => ({
        image: image.entity,
        evidence: image.evidence ?? null,
      })),
    );
    const generationPlan = createGenerationPlanFromTurnPlan(
      input.activeGeneration.responseMode,
      plan,
    );
    const controller = new AbortController();
    const selectedById = new Map(
      selectedImages.map((image) => [image.entity.id, image]),
    );
    const plannedVisionExecutor = new VisionExecutor({
      getImage: (imageId) => selectedById.get(imageId)?.entity ?? null,
      getEvidence: (imageId) => selectedById.get(imageId)?.evidence ?? null,
    });
    let executedVision: ReturnType<VisionExecutor['execute']> | null = null;
    const executor = new ControlledImageTurnExecutor({
      resolveReferences: (authoritativePlan) => authoritativePlan.references,
      selectImages: () => selectedImages.map((image) => image.entity),
      selectContextSources: (authoritativePlan) => authoritativePlan.requiredContextSources,
      assembleContext: () => context,
      executeVision: (visionPlan, _images, signal) => {
        executedVision = plannedVisionExecutor.execute(visionPlan, signal, {
          question: input.request.question,
        });
        return executedVision;
      },
      projectGeneration: () => generationPlan,
      executeInference: async (authoritativePlan) => {
        if (executedVision === null) {
          throw new Error('Controlled vision execution result is unavailable.');
        }
        const pixelInput = executedVision.imageInputs.find(
          (image) => image.localAssetReference !== null,
        );
        const imagePath = pixelInput?.localAssetReference ?? null;
        const groundedContext = assemblePlannedTurnContext(
          authoritativePlan,
          input.snapshot,
          selectedImages.map((image) => ({
            image: image.entity,
            evidence: executedVision?.imageDiagnostics.find(
              (diagnostic) => diagnostic.imageId === image.entity.id,
            )?.action === 'reused-evidence'
              ? image.evidence ?? null
              : null,
          })),
        );
        if (
          pixelInput !== undefined
          && pixelInput.sourceMessageId !== input.activeGeneration.originatingUserMessageId
        ) {
          input.activeGeneration.reinferenceImageAssetId = pixelInput.imageId;
        }
        const inferenceRequest = this.createInferenceRequest(
          input.activeGeneration,
          {
            question: controlledQuestion(
              authoritativePlan,
              input.request.question,
              executedVision,
            ),
            imagePath,
          },
          input.requestId,
        );
        inferenceRequest.visionExecutionPlan = authoritativePlan.vision;
        inferenceRequest.visionEvidenceExecution = {
          pixelInspectionImageIds: [...executedVision.pixelInspectionImageIds],
          requiresStructuredExtraction: executedVision.requiresStructuredExtraction,
          failureReason: executedVision.failureReason,
        };
        inferenceRequest.softTargetTokens = generationPlan.softTargetTokens;
        inferenceRequest.hardSafetyLimitTokens = generationPlan.hardSafetyLimitTokens;
        inferenceRequest.gracefulCompletionReserveTokens =
          generationPlan.gracefulCompletionReserveTokens;
        inferenceRequest.generationPlanId = generationPlan.diagnosticsId;
        inferenceRequest.generationTaskKind = generationPlan.taskKind;
        inferenceRequest.loopDetectionEligible = generationPlan.loopDetectionEligible;
        input.activeGeneration.generationPlan = generationPlan;
        input.activeGeneration.softTargetTokens = generationPlan.softTargetTokens;
        input.activeGeneration.selectedContext = groundedContext;
        input.activeGeneration.requestKind = imagePath === null ? 'text' : 'image';
        input.activeGeneration.imageSupplied = imagePath !== null;

        this.dependencies.historyStore.save(input.conversation);
        this.activeGeneration = input.activeGeneration;
        this.setRuntimeState({
          conversationId: input.activeGeneration.conversationId,
          originatingUserMessageId: input.activeGeneration.originatingUserMessageId,
          assistantMessageId: input.activeGeneration.assistantMessageId,
          streamingText: input.activeGeneration.seedText,
          isOwnerOfActiveInference: true,
        });
        this.startQueueSubmission(input.activeGeneration, inferenceRequest, groundedContext);
        return { answer: '' };
      },
    });
    const execution = await executor.execute(plan, controller.signal);
    input.activeGeneration.architectureDiagnostics = withControlledExecutionDiagnostic(
      input.activeGeneration.architectureDiagnostics,
      execution.audit,
    );
    this.clearDraft(input.draftConversationId);
    return {
      conversationId: input.activeGeneration.conversationId,
      originatingUserMessageId: input.activeGeneration.originatingUserMessageId,
      assistantMessageId: input.activeGeneration.assistantMessageId,
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

    // A retry is a fresh, independent attempt: it starts from EMPTY streaming and
    // checkpoint text (seedText '') so it can never inherit or resurrect the prior
    // attempt's partial output if this one produces less (or errors early).
    await this.launchLinkedAttempt({
      conversationId,
      conversation,
      userMessageId: userMessage.id,
      question: userMessage.text,
      imagePath: firstImagePath(userMessage),
      seedText: '',
      generationTaskKind: undefined,
      action: 'retry',
    });
  }

  /**
   * Regenerates a completed assistant response as a NEW immutable attempt linked
   * to the same user message. Prior attempts are preserved (never overwritten);
   * the new attempt becomes the active one shown.
   */
  async regenerateResponse(conversationId: string, assistantMessageId: string): Promise<void> {
    this.assertCanStartGeneration();

    const conversation = this.dependencies.historyStore.get(conversationId);
    if (conversation === null) {
      throw new Error(`Conversation ${conversationId} was not found.`);
    }
    const assistantIndex = conversation.messages.findIndex(
      (message) => message.id === assistantMessageId && message.role === 'assistant',
    );
    if (assistantIndex < 1) {
      throw new Error(`Assistant message ${assistantMessageId} was not found.`);
    }
    const assistantMessage = conversation.messages[assistantIndex];
    const userMessage = findPairedUserMessage(conversation.messages, assistantIndex);
    if (assistantMessage?.status !== 'completed' || userMessage === null) {
      throw new Error(`Assistant message ${assistantMessageId} cannot be regenerated.`);
    }

    await this.launchLinkedAttempt({
      conversationId,
      conversation,
      userMessageId: userMessage.id,
      question: userMessage.text,
      imagePath: firstImagePath(userMessage),
      seedText: '',
      generationTaskKind: undefined,
      action: 'regenerate',
    });
  }

  /**
   * Continues a length-truncated answer as a NEW immutable attempt linked to the
   * same user message. The truncated text is carried forward as the continuation
   * seed so the model continues seamlessly WITHOUT repeating what is already shown.
   */
  async continueTruncatedMessage(conversationId: string, assistantMessageId: string): Promise<void> {
    this.assertCanStartGeneration();

    const conversation = this.dependencies.historyStore.get(conversationId);
    if (conversation === null) {
      throw new Error(`Conversation ${conversationId} was not found.`);
    }
    const assistantIndex = conversation.messages.findIndex(
      (message) => message.id === assistantMessageId && message.role === 'assistant',
    );
    if (assistantIndex < 1) {
      throw new Error(`Assistant message ${assistantMessageId} was not found.`);
    }
    const assistantMessage = conversation.messages[assistantIndex];
    const userMessage = findPairedUserMessage(conversation.messages, assistantIndex);
    if (
      assistantMessage?.status !== 'completed' ||
      assistantMessage.finishReason !== 'length' ||
      userMessage === null
    ) {
      throw new Error(`Assistant message ${assistantMessageId} cannot be continued.`);
    }

    await this.launchLinkedAttempt({
      conversationId,
      conversation,
      userMessageId: userMessage.id,
      // A continuation is a text turn: the original image evidence already lives in
      // the conversation's context memory, so it is not reprocessed here.
      question: buildContinuationPrompt(userMessage.text, assistantMessage.text),
      imagePath: null,
      seedText: assistantMessage.text,
      generationTaskKind: 'continuation',
      action: 'continue',
    });
  }

  /**
   * Shared tail for retry / regenerate / continue: appends a fresh generating
   * assistant attempt for `userMessageId`, orchestrates context, persists, and
   * starts the queue. The new attempt supersedes the prior active attempt for
   * that user message while every prior attempt is preserved in history.
   */
  private async launchLinkedAttempt(input: {
    conversationId: string;
    conversation: Conversation;
    userMessageId: string;
    question: string;
    imagePath: string | null;
    seedText: string;
    generationTaskKind?: import('../inference/GenerationTuning').GenerationTaskKind;
    action: Exclude<UniversalTurnAction, 'submit'>;
  }): Promise<void> {
    const now = this.dependencies.now();
    const focusLedger = this.dependencies.getConversationFocusLedger(input.conversationId);
    const replacementAssistantMessageId = this.dependencies.createId('assistant-message');
    const requestId = this.dependencies.createId('request');
    const activeGeneration: ActiveGeneration = {
      conversationId: input.conversationId,
      originatingUserMessageId: input.userMessageId,
      assistantMessageId: replacementAssistantMessageId,
      responseMode: input.conversation.responseMode ?? this.dependencies.getDefaultResponseMode(),
      requestKind: 'retry',
      imageSupplied: input.imagePath !== null,
      lastObservedText: '',
      lastCheckpointText: '',
      lastCheckpointAt: 0,
      seedText: input.seedText,
      focusLedgerBefore: focusLedger,
      focusLedger,
      focusLedgerPublicationStatus: 'current',
    };
    const messages: ConversationMessage[] = [
      ...input.conversation.messages,
      {
        id: replacementAssistantMessageId,
        role: 'assistant',
        text: '',
        attachments: [],
        status: 'generating',
        errorMessage: null,
        createdAt: now,
      },
    ];
    const updatedConversationWithoutMemory: Conversation = {
      ...input.conversation,
      updatedAt: now,
      status: 'streaming',
      errorMessage: null,
      messages,
    };
    const snapshot = createCanonicalConversationSnapshot(
      updatedConversationWithoutMemory,
      input.userMessageId,
    );
    const planningImages =
      this.dependencies.listControlledPlanningImages(input.conversationId);
    const universalPlanning = planUniversalTurn({
      snapshot,
      activation: this.dependencies.plannerActivation,
      images: planningImages,
      focusLedger: toConversationFocusPlannerInput(focusLedger),
      action: input.action,
      planner: this.dependencies.turnPlanner,
    });
    const activation = resolvePlannerActivation(
      this.dependencies.plannerActivation,
      universalPlanning.planning.plan.scenarioClass,
    );
    if (!activation.useLegacySemantics) {
      await this.startPlannedTurn({
        activeGeneration,
        conversation: updatedConversationWithoutMemory,
        request: { question: input.question, imagePath: input.imagePath },
        requestId,
        snapshot,
        planning: universalPlanning,
        draftConversationId: input.conversationId,
      });
      return;
    }

    // Explicit whole-turn rollback boundary.
    const recoveryCandidates = this.dependencies.listIndependentRecoveryCandidates(
      snapshot,
      {
        imageEntities: planningImages.map((image) => image.entity),
        entityAliases: planningImages.map((image) => ({
          id: image.entity.id,
          sourceMessageId: image.entity.sourceMessageId,
          aliases: image.aliases,
        })),
        activeComparisonImageIds: focusImageIds(focusLedger),
      },
    );
    const crossChat = this.dependencies.getCrossChatOptions(input.conversationId);
    const queryVector = await this.resolveEligibleQueryVector(
      snapshot,
      activeGeneration.responseMode,
      crossChat,
    );
    const orchestration = this.dependencies.contextOrchestrator.orchestrate(
      snapshot,
      {
        responseMode: activeGeneration.responseMode,
        diagnosticsEnabled: true,
        queryVector,
        crossChat,
        independentRecovery: {
          enabled: this.dependencies.plannerActivation.independentRecoveryEnabled,
          candidates: this.dependencies.listIndependentRecoveryCandidates(
            snapshot,
            {
              imageEntities: this.dependencies
                .listControlledPlanningImages(input.conversationId)
                .map((image) => image.entity),
              entityAliases: this.dependencies
                .listControlledPlanningImages(input.conversationId)
                .map((image) => ({
                  id: image.entity.id,
                  sourceMessageId: image.entity.sourceMessageId,
                  aliases: image.aliases,
                })),
              activeComparisonImageIds:
                focusImageIds(focusLedger),
            },
          ),
        },
      },
    );
    activeGeneration.architectureDiagnostics = createTurnArchitectureDiagnostics({
      activation,
      planning: universalPlanning.planning,
      recovery: {
        enabled: this.dependencies.plannerActivation.independentRecoveryEnabled,
        classifiedIndependent: false,
        considered: recoveryCandidates.length,
        recovered: recoveryCandidates,
      },
      scenarioClass: universalPlanning.planning.plan.scenarioClass,
      legacySemanticDecisionCount: 1,
    });
    const generationPlan = createGenerationPlan(
      activeGeneration.responseMode,
      input.question,
      orchestration.diagnostics?.classification ??
        classifyRequest(snapshot, activeGeneration.responseMode, {
          enabled: crossChat.enabled,
          conversationExcluded: crossChat.currentConversationExcluded,
        }),
      orchestration.contextNeedProfile.activeImageEvidence ||
        orchestration.contextNeedProfile.olderImageEvidence
        ? 'image'
        : 'text',
      input.generationTaskKind,
    );
    activeGeneration.generationPlan = generationPlan;
    activeGeneration.softTargetTokens = generationPlan.softTargetTokens;
    activeGeneration.contextDiagnostics = orchestration.diagnostics;
    activeGeneration.selectedContext = orchestration.context;
    const updatedConversation: Conversation = {
      ...updatedConversationWithoutMemory,
      contextMemory: orchestration.memory,
    };

    this.dependencies.historyStore.save(updatedConversation);
    this.activeGeneration = activeGeneration;
    this.setRuntimeState({
      conversationId: input.conversationId,
      originatingUserMessageId: input.userMessageId,
      assistantMessageId: replacementAssistantMessageId,
      // Show the carried-forward truncated text immediately so a continuation does
      // not appear to restart from an empty bubble.
      streamingText: input.seedText,
      isOwnerOfActiveInference: true,
    });

    this.startQueueSubmission(
      activeGeneration,
      this.applyImageSelection(
        activeGeneration,
        this.createInferenceRequest(
          activeGeneration,
          { question: input.question, imagePath: input.imagePath },
          requestId,
        ),
        orchestration.imageSelection,
      ),
      orchestration.context,
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
      const composed = this.composeStreamedText(activeGeneration, state.response);
      if (composed !== '') {
        activeGeneration.lastObservedText = composed;
      }
      this.checkpointIfDue(activeGeneration, activeGeneration.lastObservedText);
      this.setRuntimeState({
        ...this.runtimeStateFor(activeGeneration),
        streamingText: composed,
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
    const composedResponse = this.composeStreamedText(activeGeneration, state.response);
    if (composedResponse !== '') {
      activeGeneration.lastObservedText = composedResponse;
    }
    this.flushCheckpoint(activeGeneration, activeGeneration.lastObservedText);
    const finishReason = resolveMessageFinishReason(state, messageStatus);
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
                    ? (composedResponse !== '' ? composedResponse : activeGeneration.lastObservedText)
                    : activeGeneration.lastObservedText || message.text,
                status: messageStatus,
                errorMessage,
                finishReason,
              }
            : message
        ),
      });
      if (state.status === 'completed' && state.hiddenEvidence != null) {
        const persistenceStartedAt = this.dependencies.now();
        let persistenceCompleted = false;
        try {
          if (activeGeneration.reinferenceImageAssetId === undefined) {
            this.dependencies.persistEvidence(
              activeGeneration.conversationId,
              activeGeneration.originatingUserMessageId,
              state.hiddenEvidence,
            );
          } else {
            this.dependencies.persistEvidence(
              activeGeneration.conversationId,
              activeGeneration.originatingUserMessageId,
              state.hiddenEvidence,
              { imageAssetId: activeGeneration.reinferenceImageAssetId, reinferred: true },
            );
          }
          persistenceCompleted = true;
        } catch {
          // A storage failure must not crash or duplicate a completed controlled
          // answer. Diagnostics retain valid-unpersisted so the image can be
          // re-inspected from its independently registered identity.
        } finally {
          activeGeneration.evidencePersistence = {
            durationMs: Math.max(0, this.dependencies.now() - persistenceStartedAt),
            completed: persistenceCompleted,
          };
        }
      }
      if (state.status === 'completed') {
        try {
          activeGeneration.focusLedger =
            this.dependencies.publishConversationFocusLedger(activeGeneration.conversationId);
          activeGeneration.focusLedgerPublicationStatus = 'updated';
        } catch {
          activeGeneration.focusLedgerPublicationStatus = 'rebuild-required';
        }
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
    this.setRuntimeState(
      this.idleRuntimeState(activeGeneration, composedResponse, state.limitWarning ?? null),
    );
  }

  /** Prepends a continuation's seed so streamed/final text stays seamless. */
  private composeStreamedText(activeGeneration: ActiveGeneration, streamed: string): string {
    if (activeGeneration.seedText === '') {
      return streamed;
    }
    return streamed === '' ? activeGeneration.seedText : `${activeGeneration.seedText}${streamed}`;
  }

  private recordDiagnosticTurn(activeGeneration: ActiveGeneration, state: InferenceState): void {
    const trace = state.inferenceTrace;
    const development = isDevelopmentInferenceTraceEnabled();
    const objective = state.objectiveResult ?? null;
    const execution = withEvidencePersistenceTiming(
      state.executionDiagnostics ?? null,
      activeGeneration.evidencePersistence,
    );
    const modeConfig = getResponseModeConfig(activeGeneration.responseMode);
    const context = activeGeneration.contextDiagnostics;
    const groundingVerdict = activeGeneration.selectedContext === undefined
      ? null
      : assessGroundingFromSources(
          state.response,
          createGroundingSourceSet(
            activeGeneration.selectedContext,
            state.hiddenEvidence ?? null,
            activeGeneration.conversationId,
          ),
        );
    const effectiveContext = context === undefined
      ? undefined
      : {
          ...context,
          groundingVerdict,
          estimatedPromptTokens: objective?.estimatedPromptTokens ?? null,
          finalNativePromptTokens:
            objective?.finalNativePromptTokens ?? objective?.promptTokens ?? null,
        };
    const finishReason = resolveMessageFinishReason(
      state,
      state.status === 'completed'
        ? 'completed'
        : state.status === 'cancelled'
          ? 'interrupted'
          : 'failed',
    );
    const summary: ProductionDiagnosticTurnSummary = {
      responseMode: activeGeneration.responseMode,
      requestKind: activeGeneration.requestKind,
      promptTokenCount: objective?.promptTokens ?? 0,
      generatedTokenCount: objective?.generatedTokens ?? 0,
      extractionGeneratedTokenCount:
        execution?.extractionGeneratedTokens
        ?? objective?.extractionGeneratedTokens
        ?? 0,
      visibleGeneratedTokenCount:
        execution?.visibleGeneratedTokens
        ?? objective?.visibleGeneratedTokens
        ?? objective?.generatedTokens
        ?? 0,
      extractionSchemaMode:
        execution?.extractionSchemaMode
        ?? objective?.extractionSchemaMode
        ?? 'not-used',
      extractionSchemaVersion:
        execution?.extractionSchemaVersion
        ?? objective?.extractionSchemaVersion
        ?? null,
      extractionAttemptLimitsTokens:
        execution?.extractionAttemptLimitsTokens
        ?? objective?.extractionAttemptLimitsTokens
        ?? [],
      firstTokenTimeMs: objective?.answerTtftMs ?? state.metrics?.firstTokenLatencyMs ?? 0,
      firstVisibleTokenLatencyMs:
        objective?.answerTtftMs ?? state.metrics?.firstTokenLatencyMs ?? null,
      totalTimeMs:
        execution?.elapsedMs
        ?? objective?.totalEndToEndLatencyMs
        ?? state.metrics?.totalWallTimeMs
        ?? 0,
      activeStage: execution?.activeStage ?? null,
      lastCompletedStage: execution?.lastCompletedStage ?? null,
      latencyStages: execution?.stages ?? [],
      evidenceState: execution?.evidenceState ?? 'not-applicable',
      evidenceValidationOutcome:
        execution?.evidenceValidationOutcome
        ?? evidenceValidationOutcomeFor(execution?.evidenceState ?? 'not-applicable'),
      evidencePersistenceOutcome: evidencePersistenceOutcomeFor(
        execution?.evidenceState ?? 'not-applicable',
        activeGeneration.evidencePersistence,
      ),
      cancellationStage:
        execution?.cancellationStage
        ?? (state.status === 'cancelled' ? execution?.activeStage ?? null : null),
      finishReason,
      looping: finishReason === 'looping' || objective?.looping === true,
      truncated: finishReason === 'length' || objective?.truncated === true,
      contextSelection: {
        recentTurnsConsidered: effectiveContext?.recentTurnsConsidered ?? 0,
        recentTurnsSelected: effectiveContext?.recentTurnsSelected.length ?? 0,
        mediaEvidenceSelected:
          effectiveContext?.mediaEvidenceCandidates.filter((candidate) => candidate.selected).length ?? 0,
        factsSelected: effectiveContext?.factCandidates.filter((candidate) => candidate.selected).length ?? 0,
        summariesSelected:
          effectiveContext?.summaryCandidates.filter((candidate) => candidate.selected).length ?? 0,
        budgetMaximumUnits: effectiveContext?.budget.maximumUnits ?? modeConfig.contextBudgetUnits,
        budgetUsedUnits: effectiveContext?.budget.usedUnits ?? 0,
        classification: effectiveContext?.classification ?? null,
        contextNeedProfile: effectiveContext?.contextNeedProfile ?? null,
        retrievalMode: effectiveContext?.retrievalMode ?? 'none',
        retrievalModeReason: effectiveContext?.retrievalModeReason ?? 'diagnostics-unavailable',
        retrievalQueried: effectiveContext?.retrievalQueried ?? false,
        retrievalCandidatesReturned: effectiveContext?.retrievalCandidatesReturned ?? 0,
        retrievalItemsSelected: effectiveContext?.retrievalItemsSelected ?? 0,
        actualSources: effectiveContext?.actualSources ?? null,
        proposedRouting: effectiveContext?.proposedRouting ?? null,
        imageDecision: effectiveContext?.imageDecision ?? 'not-applicable',
        imageReferenceAmbiguous: effectiveContext?.imageReferenceAmbiguous ?? false,
        imageReferenceResolution: effectiveContext?.imageReferenceResolution ?? 'not-applicable',
        crossChatActive: effectiveContext?.crossChatActive ?? false,
        crossChatQueried: effectiveContext?.crossChatQueried ?? false,
        crossChatItemsSelected: effectiveContext?.crossChatItemsSelected ?? 0,
        estimatedPromptTokens: effectiveContext?.estimatedPromptTokens ?? null,
        finalNativePromptTokens: effectiveContext?.finalNativePromptTokens ?? null,
        groundingVerdict,
      },
      targetTokenCount:
        objective?.softTargetTokens
        ?? activeGeneration.softTargetTokens
        ?? modeConfig.answerTargetTokens,
      generationLimit:
        objective?.effectiveNativeGenerationLimit
        ?? activeGeneration.generationPlan?.hardSafetyLimitTokens
        ?? modeConfig.generationLimit,
      targetTokenBudget:
        objective?.targetTokenBudget
        ?? objective?.softTargetTokens
        ?? activeGeneration.generationPlan?.targetTokenBudget
        ?? activeGeneration.softTargetTokens
        ?? modeConfig.answerTargetTokens,
      emergencyHardCeilingTokens:
        objective?.emergencyHardCeilingTokens
        ?? objective?.effectiveNativeGenerationLimit
        ?? activeGeneration.generationPlan?.emergencyHardCeilingTokens
        ?? modeConfig.generationLimit,
      semanticCompletionReached:
        objective?.semanticCompletionReached
        ?? (finishReason === 'natural' && state.status === 'completed'),
      gracefulCompletionModeEntered:
        objective?.gracefulCompletionModeEntered
        ?? false,
      actualStopReason:
        objective?.actualStopReason
        ?? diagnosticStopReason(finishReason),
      softTargetTokens:
        objective?.softTargetTokens
        ?? activeGeneration.softTargetTokens
        ?? modeConfig.answerTargetTokens,
      responseModeHardMaximum:
        objective?.responseModeHardMaximum ?? modeConfig.generationLimit,
      effectiveNativeGenerationLimit:
        objective?.effectiveNativeGenerationLimit
        ?? activeGeneration.generationPlan?.hardSafetyLimitTokens
        ?? modeConfig.generationLimit,
      generationPlanId:
        activeGeneration.generationPlan?.diagnosticsId ?? 'response-mode-default-v1',
      generationTaskKind:
        objective?.generationTaskKind
        ?? activeGeneration.generationPlan?.taskKind
        ?? 'concise-prose',
      samplingProfile:
        objective?.samplingProfile ?? samplingProfileForRequestKind(
          activeGeneration.requestKind === 'image' ? 'answer' : 'chat',
        ),
      imageSupplied: activeGeneration.imageSupplied,
      conversationFocus: toProductionFocusSummary(
        activeGeneration.focusLedger,
        activeGeneration.focusLedgerPublicationStatus,
      ),
      conversationFocusBefore: toProductionFocusSummary(
        activeGeneration.focusLedgerBefore,
        'current',
      ),
      conversationFocusAfter: toProductionFocusSummary(
        activeGeneration.focusLedger,
        activeGeneration.focusLedgerPublicationStatus,
      ),
      modelId:
        execution?.modelId
        ?? objective?.modelId
        ?? 'QWEN3_VL_2B_INSTRUCT_Q4_K_M',
      generationConfigId:
        execution?.generationConfigId
        ?? objective?.generationConfigId
        ?? CURRENT_GENERATION_CONFIG_ID,
      pipelineVariantId:
        execution?.pipelineVariantId
        ?? objective?.pipelineVariantId
        ?? CURRENT_PIPELINE_VARIANT_ID,
      appBuildId: execution?.appBuildId ?? objective?.appBuildId ?? 'unknown-build',
      gitCommitSha: execution?.gitCommitSha ?? 'unknown',
      gitBranch: execution?.gitBranch ?? 'unknown',
      workingTreeState: execution?.workingTreeState ?? 'unknown',
      buildIdentifier:
        execution?.buildIdentifier
        ?? execution?.appBuildId
        ?? objective?.appBuildId
        ?? 'unknown-build',
      deviceNameModel:
        execution?.deviceNameModel
        ?? objective?.deviceNameModel
        ?? 'unknown-device',
      totalMemoryBytes: execution?.totalMemoryBytes ?? null,
      runtimeUsedMemoryBytes: execution?.runtimeUsedMemoryBytes ?? null,
      thermalState: execution?.thermalState ?? null,
    };

    diagnosticsTraceStore.append({
      id: trace?.id ?? `turn-${activeGeneration.assistantMessageId}`,
      conversationId: activeGeneration.conversationId,
      originatingUserMessageId: activeGeneration.originatingUserMessageId,
      assistantMessageId: activeGeneration.assistantMessageId,
      capturedAt: this.dependencies.now(),
      trace: development ? trace ?? null : null,
      objectiveResult: development ? objective : null,
      contextDiagnostics: development ? effectiveContext ?? null : null,
      architectureDiagnostics:
        activeGeneration.architectureDiagnostics === undefined
          ? null
          : withTerminalVisionEvidenceDiagnostic(
              activeGeneration.architectureDiagnostics,
              {
                hiddenEvidencePresent: state.hiddenEvidence !== null && state.hiddenEvidence !== undefined,
                extractionFailurePresent: state.pinnedExtraction !== null,
                terminalStatus: state.status === 'completed'
                  ? 'completed'
                  : state.status === 'cancelled'
                    ? 'cancelled'
                    : 'failed',
              },
            ),
      summary,
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
      softTargetTokens: activeGeneration.softTargetTokens,
      hardSafetyLimitTokens: activeGeneration.generationPlan?.hardSafetyLimitTokens,
      gracefulCompletionReserveTokens:
        activeGeneration.generationPlan?.gracefulCompletionReserveTokens,
      generationPlanId: activeGeneration.generationPlan?.diagnosticsId,
      generationTaskKind: activeGeneration.generationPlan?.taskKind,
      loopDetectionEligible: activeGeneration.generationPlan?.loopDetectionEligible,
    };
  }

  private async resolveEligibleQueryVector(
    snapshot: ReturnType<typeof createCanonicalConversationSnapshot>,
    responseMode: ResponseMode,
    crossChat: {
      readonly enabled: boolean;
      readonly currentConversationExcluded: boolean;
      readonly eligibleConversationIds: readonly string[];
    },
  ): Promise<Float32Array | undefined> {
    const classification = classifyRequest(snapshot, responseMode, {
      enabled: crossChat.enabled,
      conversationExcluded: crossChat.currentConversationExcluded,
    });
    if (
      !classification.isLongContextRetrievalRequest
      && !classification.isCrossChatEligible
    ) {
      return undefined;
    }
    if (
      this.dependencies.embeddingService === undefined
      || this.dependencies.isEmbeddingRuntimeActive?.() !== true
    ) {
      return undefined;
    }
    try {
      return (await this.dependencies.embeddingService.embed([
        snapshot.currentMessage.text,
      ]))[0];
    } catch {
      return undefined;
    }
  }

  private applyImageSelection(
    activeGeneration: ActiveGeneration,
    request: InferenceRequest,
    selection: ImageSelectionResult | null,
  ): InferenceRequest {
    const selectedRequest = applyImageSelectionToInferenceRequest(request, selection);
    if (selectedRequest.imagePath !== null) {
      activeGeneration.requestKind = 'image';
      activeGeneration.imageSupplied = true;
    }
    if (
      selection?.decision === 'use-original' &&
      selection.imageAssetId !== null &&
      selection.sourceMessageId !== activeGeneration.originatingUserMessageId
    ) {
      activeGeneration.reinferenceImageAssetId = selection.imageAssetId;
    }
    return selectedRequest;
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
    streamingText = '',
    limitWarning: string | null = null,
  ): ConversationRuntimeState {
    return {
      conversationId: activeGeneration.conversationId,
      originatingUserMessageId: activeGeneration.originatingUserMessageId,
      assistantMessageId: activeGeneration.assistantMessageId,
      streamingText,
      isOwnerOfActiveInference: false,
      limitWarning,
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

function controlledQuestion(
  plan: TurnPlan,
  originalQuestion: string,
  vision?: VisionExecutionResult,
): string {
  if (plan.fallback === 'clarify-reference') {
    return 'Ask the user to clarify which image they mean. Do not claim that any image was inspected.';
  }
  if (plan.fallback === 'asset-unavailable') {
    return 'Explain that the requested image asset is unavailable. Do not substitute another image.';
  }
  if (vision?.failureReason?.startsWith('comparison-side-unavailable:') === true) {
    return [
      'Explain that one planner-selected comparison image is unavailable.',
      'Identify the unavailable selected side without substituting another image.',
      'Do not claim a complete visual comparison.',
    ].join(' ');
  }
  if (vision?.failureReason === 'comparison-multiple-reinspection-unavailable') {
    return [
      'Explain that both selected comparison images require pixel reinspection,',
      'but this execution can inspect only one original image at a time.',
      'Do not compare from insufficient evidence and do not substitute images.',
    ].join(' ');
  }
  if (vision?.failureReason !== null && vision?.failureReason !== undefined) {
    return [
      'Explain that the planner-selected image evidence is insufficient and its original asset',
      'cannot be inspected. Do not substitute another image or guess visual facts.',
    ].join(' ');
  }
  return originalQuestion;
}

function focusImageIds(ledger: ConversationFocusLedger): string[] {
  if (ledger.activeImageFocus === null) return [];
  return ledger.activeImageFocus.kind === 'single'
    ? [ledger.activeImageFocus.imageId]
    : [...ledger.activeImageFocus.imageIds];
}

function toProductionFocusSummary(
  ledger: ConversationFocusLedger,
  publicationStatus: ProductionConversationFocusSummary['publicationStatus'],
): ProductionConversationFocusSummary {
  return {
    schemaVersion: ledger.schemaVersion,
    lastCompletedTurnId: ledger.lastCompletedTurnId,
    activeImageIds: focusImageIds(ledger),
    lastExplicitlyReferencedImageIds: [
      ...ledger.lastExplicitlyReferencedImageIds,
    ],
    activeAssistantMessageId: ledger.activeAssistantMessageId,
    activeArtifact: ledger.activeArtifact,
    activeTopicLabels: [...ledger.activeTopicLabels],
    activeEntityLabels: [...ledger.activeEntityLabels],
    unresolvedReference: ledger.unresolvedReference,
    publicationStatus,
  };
}

export function createConversationStore(
  dependencies: ConversationStoreDependencies
): ConversationStore {
  const resolvedDependencies: Required<ConversationStoreDependencies> = {
    now: Date.now,
    createId: createStableId,
    contextOrchestrator: new ContextOrchestrator(),
    embeddingService: { embed: async () => [] },
    isEmbeddingRuntimeActive: () => false,
    getCrossChatOptions: () => ({
      enabled: false,
      currentConversationExcluded: false,
      eligibleConversationIds: [],
    }),
    getDefaultResponseMode: () => DEFAULT_RESPONSE_MODE,
    setPersistedResponseMode: () => undefined,
    persistEvidence: () => undefined,
    persistRetrievalUnits: () => undefined,
    scheduleCompaction: () => undefined,
    recordBenchmark: () => undefined,
    checkpointAssistantText: () => undefined,
    persistImage: async (_conversationId, sourcePath) => sourcePath,
    plannerActivation: DEFAULT_PLANNER_ACTIVATION,
    turnPlanner: new TurnPlanner(),
    listIndependentRecoveryCandidates: () => [],
    listControlledPlanningImages: (conversationId) =>
      fallbackPlanningImages(dependencies.historyStore, conversationId),
    visionExecutor: new VisionExecutor({
      getImage: () => null,
      getEvidence: () => null,
    }),
    getConversationFocusLedger: (conversationId) =>
      fallbackConversationFocusLedger(dependencies, conversationId),
    publishConversationFocusLedger: (conversationId) =>
      fallbackConversationFocusLedger(dependencies, conversationId),
    ...dependencies,
  };
  return new ConversationStore(resolvedDependencies);
}

function fallbackConversationFocusLedger(
  dependencies: ConversationStoreDependencies,
  conversationId: string,
): ConversationFocusLedger {
  const conversation = dependencies.historyStore.get(conversationId);
  if (conversation === null) return emptyConversationFocusLedger(conversationId);
  const attempts = new Map<string, number>();
  const activeAssistantByUser = new Map<string, string>();
  let currentUserId: string | null = null;
  for (const message of conversation.messages) {
    if (message.role === 'user') {
      currentUserId = message.id;
    } else if (currentUserId !== null) {
      activeAssistantByUser.set(currentUserId, message.id);
    }
  }
  currentUserId = null;
  const sourceMessages = conversation.messages.map((message) => {
    if (message.role === 'user') {
      currentUserId = message.id;
      return {
        id: message.id,
        role: message.role,
        replyToMessageId: null,
        attemptNumber: null,
        activeAttempt: false,
        text: message.text,
        status: message.status,
        createdAt: message.createdAt,
        finalizedAt: message.status === 'completed' ? message.createdAt : null,
      } as const;
    }
    const replyToMessageId = currentUserId;
    const attemptNumber = replyToMessageId === null
      ? 1
      : (attempts.get(replyToMessageId) ?? 0) + 1;
    if (replyToMessageId !== null) attempts.set(replyToMessageId, attemptNumber);
    return {
      id: message.id,
      role: message.role,
      replyToMessageId,
      attemptNumber,
      activeAttempt:
        replyToMessageId !== null
        && activeAssistantByUser.get(replyToMessageId) === message.id,
      text: message.text,
      status: message.status,
      createdAt: message.createdAt,
      finalizedAt: message.status === 'completed' ? message.createdAt : null,
    } as const;
  });
  const images = (
    dependencies.listControlledPlanningImages?.(conversationId)
    ?? fallbackPlanningImages(dependencies.historyStore, conversationId)
  )
    .map((image) => ({
      id: image.entity.id,
      sourceMessageId: image.entity.sourceMessageId,
      ordinal: image.entity.ordinal,
      availability: image.entity.assetAvailability,
      createdAt: image.entity.createdAt,
    }));
  return deriveConversationFocusLedger({
    conversationId,
    messages: sourceMessages,
    images,
  });
}

function fallbackPlanningImages(
  store: IHistoryStore,
  conversationId: string,
): ControlledPlanningImage[] {
  const conversation = store.get(conversationId);
  if (conversation === null) return [];
  return conversation.messages.flatMap((message, ordinal) => {
    if (message.role !== 'user') return [];
    const attachment = message.attachments.find((candidate) => candidate.kind === 'image');
    if (attachment === undefined) return [];
    const imageId = attachment.imageAssetId ?? `message-image:${message.id}`;
    const memoryEvidence = conversation.contextMemory?.mediaEvidence.find(
      (candidate) => candidate.sourceMessageId === message.id,
    );
    const sourceRevision = `attachment:${message.id}`;
    return [{
      entity: {
        id: imageId,
        conversationId,
        sourceMessageId: message.id,
        ordinal,
        assetRevision: sourceRevision,
        assetAvailability: attachment.available === false ? 'missing' : 'available',
        localAssetReference: attachment.path,
        evidenceIds: memoryEvidence === undefined ? [] : [memoryEvidence.id],
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      },
      aliases: [],
      evidence: memoryEvidence === undefined
        ? null
        : {
            id: memoryEvidence.id,
            conversationId,
            imageId,
            sourceMessageIds: [message.id],
            summary: memoryEvidence.summary,
            visibleObjects: memoryEvidence.facts.map((fact, index) => ({
              id: `fact-${index}`,
              label: fact,
              attributes: [],
              confidence: 1,
            })),
            extractedText: memoryEvidence.extractedText.map((text) => ({
              text,
              confidence: 1,
            })),
            numericValues: [],
            uncertainty: {
              overallConfidence: memoryEvidence.uncertainty.length === 0 ? 1 : 0.8,
              notes: [...memoryEvidence.uncertainty],
            },
            status: 'complete' as const,
            sourceRevision,
            createdAt: memoryEvidence.createdAt,
            updatedAt: memoryEvidence.createdAt,
          },
    }];
  });
}

function createRuntimeContextOrchestrator(): ContextOrchestrator {
  const lexicalFallback = new LexicalFallbackRetriever();
  return new ContextOrchestrator(new TokenContextBudgetPolicy(), {
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

function withEvidencePersistenceTiming(
  execution: InferenceExecutionDiagnostics | null,
  persistence: ActiveGeneration['evidencePersistence'],
): InferenceExecutionDiagnostics | null {
  if (execution === null || persistence === undefined) return execution;
  return {
    ...execution,
    elapsedMs: execution.elapsedMs + persistence.durationMs,
    lastCompletedStage:
      persistence.completed ? 'evidence-persistence' : execution.lastCompletedStage,
    stages: [
      ...execution.stages.filter((stage) => stage.stage !== 'evidence-persistence'),
      {
        stage: 'evidence-persistence',
        durationMs: persistence.durationMs,
        completed: persistence.completed,
      },
    ],
    evidenceState: persistence.completed ? 'valid' : 'valid-unpersisted',
  };
}

function evidenceValidationOutcomeFor(
  evidenceState: InferenceEvidenceState,
): NonNullable<InferenceExecutionDiagnostics['evidenceValidationOutcome']> {
  if (evidenceState === 'pending') return 'pending';
  if (evidenceState === 'valid' || evidenceState === 'valid-unpersisted') return 'valid';
  if (evidenceState === 'failed') return 'invalid';
  if (evidenceState === 'cancelled') return 'cancelled';
  return 'not-applicable';
}

function evidencePersistenceOutcomeFor(
  evidenceState: InferenceEvidenceState,
  persistence: ActiveGeneration['evidencePersistence'],
): ProductionDiagnosticTurnSummary['evidencePersistenceOutcome'] {
  if (persistence !== undefined) {
    return persistence.completed ? 'persisted' : 'failed';
  }
  if (evidenceState === 'not-applicable') return 'not-applicable';
  return 'not-attempted';
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

function listRuntimeControlledPlanningImages(
  conversationId: string,
): ControlledPlanningImage[] {
  return imageEntityRepository.listForConversation(conversationId).map((entity) => {
    const evidence = structuredImageEvidenceRepository.getLatestCompatible(
      entity.id,
      entity.assetRevision,
    );
    const sourceText = messageRepository.getMessage(entity.sourceMessageId)?.text ?? '';
    return {
      entity,
      evidence,
      aliases: [
        sourceText,
        ...(evidence === null
          ? []
          : [
              evidence.summary,
              ...evidence.visibleObjects.map((object) => object.label),
            ]),
      ].filter((alias) => alias.trim() !== ''),
    };
  });
}

/** Development-only temporary Wave A/B physical-validation activation. */
export const RUNTIME_PLANNER_ACTIVATION = plannerActivationForRuntime();

export const conversationStore: IConversationStore = createConversationStore({
  inferenceQueue,
  historyStore,
  persistImage: (conversationId, sourcePath) => durableImageStorage.persist(conversationId, sourcePath),
  contextOrchestrator: createRuntimeContextOrchestrator(),
  plannerActivation: RUNTIME_PLANNER_ACTIVATION,
  listControlledPlanningImages: listRuntimeControlledPlanningImages,
  visionExecutor: new VisionExecutor({
    getImage: (imageId) => imageEntityRepository.get(imageId),
    getEvidence: (imageId) => {
      const image = imageEntityRepository.get(imageId);
      return image === null
        ? null
        : structuredImageEvidenceRepository.getLatestCompatible(
            image.id,
            image.assetRevision,
          );
    },
  }),
  getConversationFocusLedger: (conversationId) =>
    conversationStateLedgerRepository.get(conversationId),
  publishConversationFocusLedger: (conversationId) =>
    conversationStateLedgerRepository.publish(conversationId),
  listIndependentRecoveryCandidates: (snapshot, options = {}) => {
    const planningImages = listRuntimeControlledPlanningImages(snapshot.conversationId);
    return buildRuntimeIndependentRecoveryCandidates(snapshot, {
      ...options,
      imageEntities:
        options.imageEntities
        ?? planningImages.map((image) => image.entity),
      entityAliases:
        options.entityAliases
        ?? planningImages.map((image) => ({
          id: image.entity.id,
          sourceMessageId: image.entity.sourceMessageId,
          aliases: image.aliases,
        })),
    });
  },
  getDefaultResponseMode: () => useSettingsStore.getState().defaultResponseMode,
  setPersistedResponseMode: (conversationId, mode) => {
    conversationRepository.setResponseMode(conversationId, toStoredMode(mode));
    useHistoryStore.getState().refresh();
  },
  getCrossChatOptions: (conversationId) => {
    const enabled = useSettingsStore.getState().crossChatMemoryEnabled;
    if (!enabled) {
      return {
        enabled: false,
        currentConversationExcluded: false,
        eligibleConversationIds: [],
      };
    }
    const current = conversationRepository.getConversation(conversationId);
    const currentConversationExcluded = current?.excluded_from_cross_chat === 1;
    return {
      enabled: true,
      currentConversationExcluded,
      eligibleConversationIds: currentConversationExcluded
        ? []
        : conversationRepository.listCrossChatEligibleConversationIds(),
    };
  },
  persistEvidence: (conversationId, sourceMessageId, evidence, target) => {
    if (normalizeHiddenVisualEvidence(evidence) === null) {
      return;
    }
    const asset = target === undefined
      ? imageRepository.getAssetsForMessage(sourceMessageId)[0]
      : imageRepository.getAsset(target.imageAssetId) ?? undefined;
    if (asset === undefined) {
      return;
    }
    const input = {
      conversationId,
      sourceMessageId,
      imageAssetId: asset.id,
      evidence,
      sourceRevision: `${evidence.version}:${asset.content_hash ?? asset.local_path}`,
    };
    if (target?.reinferred === true) {
      evidenceRepository.saveReinferredEvidence(input);
    } else {
      evidenceRepository.saveEvidence(input);
    }
    const imageEntity = imageEntityRepository.get(asset.id);
    if (imageEntity !== null) {
      const structuredRevision =
        `${imageEntity.assetRevision}:evidence:${evidence.version}`;
      if (target?.reinferred === true) {
        structuredImageEvidenceRepository.invalidateForReinference(
          asset.id,
          structuredRevision,
        );
      }
      structuredImageEvidenceRepository.saveFromHiddenEvidence({
        conversationId,
        imageId: asset.id,
        sourceMessageIds: [sourceMessageId],
        sourceRevision: structuredRevision,
        hiddenEvidence: evidence,
      });
    }
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
});

const runtimeCompactionService = new CompactionService({
  messages: messageRepository,
  summaries: summaryRepository,
  facts: factRepository,
  generator: createRegisteredEngineCompactionGenerator(),
});

/**
 * Builds the prompt for a continuation attempt. It gives the model the original
 * question and the answer so far, then asks it to continue seamlessly WITHOUT
 * repeating any already-shown text — the shown text is re-attached as the seed by
 * the store, so the model only needs to produce what comes next.
 */
function buildContinuationPrompt(originalQuestion: string, partialAnswer: string): string {
  return [
    'You are continuing your own previous answer that was cut off before it finished.',
    `Original question: ${originalQuestion.trim()}`,
    'Answer so far (already shown to the user — do NOT repeat any of it):',
    partialAnswer.trim(),
    'Continue directly from where the answer stops, picking up mid-sentence if needed, ' +
      'and finish the answer cleanly. Do not restate the question or re-summarize earlier points.',
  ].join('\n\n');
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

/**
 * The durable finish reason stored on a terminal assistant message. Completed
 * turns carry the engine's reported reason (`natural`/`length`); non-completed
 * terminal states map to `cancelled`/`failed` regardless of what the engine said.
 */
function resolveMessageFinishReason(
  state: InferenceState,
  messageStatus: Exclude<MessageStatus, 'generating'>,
): GenerationFinishReason {
  if (messageStatus === 'completed') {
    return state.finishReason ?? 'natural';
  }
  return messageStatus === 'interrupted' ? 'cancelled' : 'failed';
}

function diagnosticStopReason(
  finishReason: GenerationFinishReason,
): import('../inference/GenerationTuning').GenerationActualStopReason {
  if (finishReason === 'length') return 'emergency-ceiling';
  if (finishReason === 'looping') return 'loop-detected';
  if (finishReason === 'cancelled') return 'cancelled';
  if (finishReason === 'failed') return 'failed';
  return 'model-eos';
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
