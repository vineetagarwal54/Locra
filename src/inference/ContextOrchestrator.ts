import type { EvidenceReference } from '../persistence/EvidenceRepository';
import type { HybridRetriever } from '../retrieval/HybridRetriever';
import type { RetrievalCandidate, RetrievedItem } from '../retrieval/types';
import type {
  CanonicalContextTurn,
  CanonicalConversationContext,
  CanonicalConversationSnapshot,
  ContextBudgetMetadata,
  ContextMediaEvidence,
  ContextMemoryFact,
  ContextRollingSummary,
  ContextSummaryEntry,
  Conversation,
  ConversationContextMemory,
  ConversationMessage,
  VisualEvidenceRow,
} from '../types/models';

import { assessAnswerQuality } from './AnswerPostProcessor';
import { getContextCapacityBuckets } from './ContextWindow';
import {
  evaluateImageEvidenceAvailability,
  type ImageEvidenceAvailability,
} from './ImageEvidencePolicy';
import {
  resolveDescriptiveImageReference,
  type ImageReferenceCandidate,
} from './ImageReferenceResolver';
import { isDevelopmentInferenceTraceEnabled } from './InferenceTrace';
import type { HiddenVisualEvidence } from './OutputPipelineTypes';
import {
  classifyRequest,
  type RequestClassification,
} from './RequestClassifier';
import { getResponseModeConfig, type ResponseMode } from './ResponseMode';
import { isToolRefusalResponse } from './ToolRefusalRecovery';

const DEFAULT_MAXIMUM_UNITS = 14_400;
const DEFAULT_RECENT_EXACT_TURN_LIMIT = 8;
const DEFAULT_MAX_MEDIA_EVIDENCE_ITEMS = 3;
const DEFAULT_MAX_FACT_ITEMS = 6;
const DEFAULT_MAX_SUMMARY_ENTRIES = 6;
const TURN_ROLE_OVERHEAD_UNITS = 32;
const TURN_ROLE_OVERHEAD_TOKENS = 12;
const CANDIDATE_PREVIEW_MAX_CHARS = 240;
// Explicit visual language only. Generic pronouns ("it", "that") were removed:
// almost every follow-up contains one, so they pulled stale image evidence into
// plainly non-visual turns. Active image turns and lexical overlap are handled
// separately, so a genuinely image-related follow-up is still covered.
const VISUAL_REFERENCE_PATTERN =
  /\b(?:image|photo|picture|shown|visible|look|label|screen|sign|color|colour|read)\b/i;
const TOKEN_STOP_WORDS = new Set([
  'about',
  'again',
  'also',
  'and',
  'are',
  'can',
  'could',
  'did',
  'does',
  'for',
  'from',
  'have',
  'image',
  'into',
  'more',
  'that',
  'the',
  'this',
  'was',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
]);

export type ContextCandidateExclusionReason = 'budget' | 'item-cap' | 'relevance';

export interface RankedCandidateDiagnostic {
  readonly stableId: string;
  readonly relevance: number;
  readonly createdAt: number;
  readonly selected: boolean;
  readonly exclusionReason: ContextCandidateExclusionReason | null;
  readonly preview: string;
  readonly fusionSources?: ReadonlyArray<'lexical' | 'semantic'>;
  readonly exactMatchGuaranteed?: boolean;
}

export type RetrievalMode = 'fused' | 'lexical-fallback' | 'none';
export type ImageEvidenceDecision = ImageEvidenceAvailability['kind'];
export type ImageReferenceResolution =
  | 'not-applicable'
  | 'new-image'
  | 'active-image'
  | 'explicit-ordinal'
  | 'unique-description'
  | 'ambiguous-active-fallback';

export interface ProposedRoutingDiagnostic {
  readonly wouldSkipRetrieval: boolean;
  readonly reason: 'phase-3-independent-question' | 'classification-requires-context';
}

export interface ActualSourceUsageDiagnostic {
  readonly recentTurns: { readonly queried: boolean; readonly selected: number };
  readonly imageEvidence: { readonly queried: boolean; readonly selected: number };
  readonly retrieval: { readonly queried: boolean; readonly selected: number };
  readonly durableFacts: { readonly queried: boolean; readonly selected: number };
  readonly summary: { readonly queried: boolean; readonly selected: number };
}

export interface RecentTurnDiagnostic {
  readonly sourceUserMessageId: string;
  readonly sourceAssistantMessageId: string;
  readonly costUnits: number;
  readonly createdAt: number;
}

export interface ContextSelectionDiagnostics {
  readonly recentTurnsConsidered: number;
  readonly recentTurnsSelected: ReadonlyArray<RecentTurnDiagnostic>;
  readonly mediaEvidenceCandidates: ReadonlyArray<RankedCandidateDiagnostic>;
  readonly factCandidates: ReadonlyArray<RankedCandidateDiagnostic>;
  readonly summaryCandidates: ReadonlyArray<RankedCandidateDiagnostic>;
  readonly budget: ContextBudgetMetadata;
  readonly classification: RequestClassification;
  readonly retrievalMode: RetrievalMode;
  readonly retrievalModeReason: string;
  readonly retrievalQueried: boolean;
  readonly retrievalCandidatesReturned: number;
  readonly retrievalItemsSelected: number;
  readonly actualSources: ActualSourceUsageDiagnostic;
  readonly proposedRouting: ProposedRoutingDiagnostic;
  readonly imageDecision: ImageEvidenceDecision | 'not-applicable';
  readonly imageReferenceAmbiguous: boolean;
  readonly imageReferenceResolution: ImageReferenceResolution;
  readonly crossChatActive: boolean;
  readonly crossChatQueried: boolean;
  readonly crossChatItemsSelected: number;
  readonly estimatedPromptTokens: number | null;
  readonly finalNativePromptTokens: number | null;
  readonly groundingVerdict: 'supported' | 'unsupported' | null;
}

interface ConversationTurn {
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly question: string;
  readonly answer: string | null;
  readonly createdAt: number;
}

interface RankedItem<T> {
  readonly item: T;
  readonly relevance: number;
  readonly createdAt: number;
  readonly stableId: string;
}

export interface ContextBudgetPolicy {
  readonly policyId: string;
  readonly maximumUnits: number;
  readonly recentExactTurnLimit: number;
  readonly maxMediaEvidenceItems: number;
  readonly maxFactItems: number;
  readonly maxSummaryEntries: number;
  measure(content: string): number;
}

export interface CharacterContextBudgetPolicyOptions {
  maximumUnits?: number;
  recentExactTurnLimit?: number;
  maxMediaEvidenceItems?: number;
  maxFactItems?: number;
  maxSummaryEntries?: number;
}

export type TokenContextBudgetPolicyOptions = CharacterContextBudgetPolicyOptions;

export class TokenContextBudgetPolicy implements ContextBudgetPolicy {
  readonly policyId = 'token-estimate-budget-v1';
  readonly maximumUnits: number;
  readonly recentExactTurnLimit: number;
  readonly maxMediaEvidenceItems: number;
  readonly maxFactItems: number;
  readonly maxSummaryEntries: number;

  constructor(options: TokenContextBudgetPolicyOptions = {}) {
    this.maximumUnits = positiveInteger(options.maximumUnits, 2_334);
    this.recentExactTurnLimit = nonNegativeInteger(
      options.recentExactTurnLimit,
      DEFAULT_RECENT_EXACT_TURN_LIMIT,
    );
    this.maxMediaEvidenceItems = nonNegativeInteger(
      options.maxMediaEvidenceItems,
      DEFAULT_MAX_MEDIA_EVIDENCE_ITEMS,
    );
    this.maxFactItems = nonNegativeInteger(options.maxFactItems, DEFAULT_MAX_FACT_ITEMS);
    this.maxSummaryEntries = nonNegativeInteger(
      options.maxSummaryEntries,
      DEFAULT_MAX_SUMMARY_ENTRIES,
    );
  }

  measure(content: string): number {
    return Math.ceil(content.length / 3);
  }
}

export class CharacterContextBudgetPolicy implements ContextBudgetPolicy {
  readonly policyId = 'character-budget-v1';
  readonly maximumUnits: number;
  readonly recentExactTurnLimit: number;
  readonly maxMediaEvidenceItems: number;
  readonly maxFactItems: number;
  readonly maxSummaryEntries: number;

  constructor(options: CharacterContextBudgetPolicyOptions = {}) {
    this.maximumUnits = positiveInteger(options.maximumUnits, DEFAULT_MAXIMUM_UNITS);
    this.recentExactTurnLimit = nonNegativeInteger(
      options.recentExactTurnLimit,
      DEFAULT_RECENT_EXACT_TURN_LIMIT,
    );
    this.maxMediaEvidenceItems = nonNegativeInteger(
      options.maxMediaEvidenceItems,
      DEFAULT_MAX_MEDIA_EVIDENCE_ITEMS,
    );
    this.maxFactItems = nonNegativeInteger(options.maxFactItems, DEFAULT_MAX_FACT_ITEMS);
    this.maxSummaryEntries = nonNegativeInteger(
      options.maxSummaryEntries,
      DEFAULT_MAX_SUMMARY_ENTRIES,
    );
  }

  measure(content: string): number {
    return content.length;
  }
}

export interface ContextOrchestrationResult {
  readonly context: CanonicalConversationContext;
  readonly memory: ConversationContextMemory;
  readonly imageSelection: ImageSelectionResult | null;
  readonly diagnostics?: ContextSelectionDiagnostics;
}

export interface ImageSelectionResult {
  readonly decision: ImageEvidenceDecision;
  readonly imageAssetId: string | null;
  readonly sourceMessageId: string | null;
  readonly originalPath: string | null;
}

export interface ContextOrchestrationOptions {
  readonly diagnosticsEnabled?: boolean;
  readonly responseMode?: ResponseMode;
  readonly referencedImage?: Omit<EvidenceReference, 'conversationId'>;
  readonly queryVector?: Float32Array;
  readonly crossChat?: {
    readonly enabled: boolean;
    readonly currentConversationExcluded: boolean;
    readonly eligibleConversationIds: readonly string[];
  };
}

export interface HybridContextSources {
  readonly retriever?: Pick<HybridRetriever, 'search'> & Partial<Pick<HybridRetriever, 'searchWithDiagnostics'>>;
  readonly evidenceRepository?: {
    getActiveImageEvidence(conversationId: string): VisualEvidenceRow | null;
    resolveReferencedImageEvidence(reference: EvidenceReference): VisualEvidenceRow | null;
    listImageReferenceCandidates?(conversationId: string): ImageReferenceCandidate[];
  };
  readonly listLexicalCandidates?: (
    conversationIds: readonly string[],
  ) => readonly RetrievalCandidate[];
  readonly listDurableFacts?: (conversationId: string) => readonly ContextMemoryFact[];
  readonly getNewestReadySummary?: (conversationId: string) => string | null;
  readonly retrievalManifest?: {
    readonly embeddingVersion: string;
    readonly artifactHash: string;
  };
}

export class ContextOrchestrator {
  constructor(
    private readonly budgetPolicy: ContextBudgetPolicy = new TokenContextBudgetPolicy(),
    private readonly sources: HybridContextSources = {},
  ) {}

  orchestrate(
    snapshot: CanonicalConversationSnapshot,
    options: ContextOrchestrationOptions = {},
  ): ContextOrchestrationResult {
    const diagnosticsEnabled = options.diagnosticsEnabled ?? isDevelopmentInferenceTraceEnabled();
    const responseMode = options.responseMode ?? 'Medium';
    const crossChat = options.crossChat ?? {
      enabled: false,
      currentConversationExcluded: false,
      eligibleConversationIds: [],
    };
    const initialClassification = classifyRequest(
      snapshot,
      responseMode,
      {
        enabled: crossChat.enabled,
        conversationExcluded: crossChat.currentConversationExcluded,
      },
    );
    const referenceResolution = this.resolveImageReference(
      snapshot,
      initialClassification,
    );
    const classification = referenceResolution.classification;
    const hasImageContext = classification.isNewImageQuestion
      || classification.isSameImageFollowUp
      || classification.isOlderImageReference
      || classification.isPixelDependent;
    const policy = options.responseMode === undefined
      ? this.budgetPolicy
      : responseModeBudgetPolicy(
          this.budgetPolicy,
          options.responseMode,
          snapshot.currentMessage.text,
          hasImageContext,
        );
    const conversationTurns = conversationTurnsFromMessages(snapshot.priorMessages);
    const pureIndependent = classification.isIndependentTextQuestion
      && !hasImageContext
      && !classification.isLongContextRetrievalRequest
      && !classification.isCrossChatEligible;
    const includeRecentTurns = !pureIndependent && (
      classification.isTextFollowUp
      || hasImageContext
      || classification.isLongContextRetrievalRequest
      || classification.isCrossChatEligible
    );

    const isActiveImageTurn = messageHasImage(snapshot.currentMessage);
    const imageResolution = hasImageContext
      ? this.resolveImageSelection(snapshot, classification, options)
      : null;
    const imageSelection = imageResolution === null ? null : imageResolution.selection;
    const persistedEvidence = imageResolution?.evidence ??
      (imageResolution === null && hasImageContext
        ? this.resolvePersistedEvidence(
            snapshot.conversationId,
            snapshot.currentMessage.text,
            isActiveImageTurn,
            options,
          )
        : null);
    const selectedMemoryEvidence = imageResolution?.memoryEvidence ?? null;
    const protectedMediaEvidence =
      imageResolution !== null && imageResolution.selection.decision !== 'use-evidence'
        ? emptyMediaEvidenceSelection(0)
        : persistedEvidence !== null
          ? selectProtectedEvidence(persistedEvidence, 0, policy, diagnosticsEnabled)
          : selectedMemoryEvidence !== null
            ? selectProtectedContextEvidence(
                selectedMemoryEvidence,
                0,
                policy,
                diagnosticsEnabled,
              )
            : null;
    let usedUnits = protectedMediaEvidence?.usedUnits ?? 0;
    const selection = selectRecentTurns(
      includeRecentTurns ? conversationTurns : [],
      usedUnits,
      policy,
      diagnosticsEnabled,
    );
    usedUnits = selection.usedUnits;
    const olderTurns = conversationTurns.slice(
      0,
      conversationTurns.length - selection.turns.length,
    );
    const memory = rebuildDerivedMemory(snapshot, olderTurns);
    const mediaEvidence = protectedMediaEvidence ?? selectMediaEvidenceWithinBudget(
                memory.mediaEvidence,
                snapshot.currentMessage.text,
                isActiveImageTurn,
                policy.maxMediaEvidenceItems,
                usedUnits,
                policy,
                diagnosticsEnabled,
              );
    usedUnits = mediaEvidence.usedUnits;

    const includeSameChatLongContext = !pureIndependent
      && classification.isLongContextRetrievalRequest;
    const includeCrossChat = classification.isCrossChatEligible;
    const includeRetrieval = includeSameChatLongContext || includeCrossChat;
    const retrievalConversationIds = resolveCrossChatConversationIds(
      snapshot.conversationId,
      includeCrossChat,
      crossChat.currentConversationExcluded,
      crossChat.eligibleConversationIds,
    );
    const retrieval = includeRetrieval
      ? this.retrieve(
          snapshot,
          retrievalConversationIds,
          responseModeLimit(options.responseMode),
          options,
        )
      : skippedRetrieval(
          pureIndependent ? 'independent-question-hard-skip' : 'classification-not-long-context',
        );
    const crossChatQueried = retrieval.queried && retrievalConversationIds.length > 1;
    const durableFacts = includeSameChatLongContext
      ? this.sources.listDurableFacts?.(snapshot.conversationId) ?? memory.importantFacts
      : [];
    const persistedSummary = includeSameChatLongContext
      ? this.sources.getNewestReadySummary?.(snapshot.conversationId)
      : null;

    // Allocate from most protected to least protected. This produces the
    // required pressure behavior without a destructive second pass:
    // retrieved items lose room first, then facts, then summary; recent turns
    // and referenced image evidence were already protected above.
    const summaryEntries = persistedSummary === undefined
      ? {
          ...selectWithinBudget(
            rankSummaryEntries(memory.rollingSummary?.entries ?? [], snapshot.currentMessage.text),
            policy.maxSummaryEntries,
            usedUnits,
            policy,
            formatSummaryEntry,
            diagnosticsEnabled,
          ),
          summary: undefined,
        }
      : selectSummaryWithinBudget(persistedSummary, usedUnits, policy);
    usedUnits = summaryEntries.usedUnits;

    const importantFacts = selectWithinBudget(
      rankFacts(durableFacts, snapshot.currentMessage.text),
      policy.maxFactItems,
      usedUnits,
      policy,
      formatMemoryFact,
      diagnosticsEnabled,
    );
    usedUnits = importantFacts.usedUnits;

    const sameChatRetrieved = selectRetrievedWithinBudget(
      retrieval.items.filter((item) => item.sourceConversationId === snapshot.conversationId),
      usedUnits,
      policy,
    );
    usedUnits = sameChatRetrieved.usedUnits;
    const crossChatRetrieved = selectRetrievedWithinBudget(
      retrieval.items.filter((item) => item.sourceConversationId !== snapshot.conversationId),
      usedUnits,
      policy,
    );
    usedUnits = crossChatRetrieved.usedUnits;
    const crossChatItemsSelected = crossChatRetrieved.items.length;

    const budget: ContextBudgetMetadata = {
      policyId: policy.policyId,
      maximumUnits: policy.maximumUnits,
      usedUnits,
    };

    const result: ContextOrchestrationResult = {
      context: {
        version: 'canonical-conversation-v2',
        recentTurns: selection.turns.map(cloneContextTurn),
        mediaEvidence: mediaEvidence.items.map(cloneMediaEvidence),
        importantFacts: [
          ...sameChatRetrieved.items,
          ...crossChatRetrieved.items,
          ...importantFacts.items.map(cloneMemoryFact),
        ],
        olderSummary: summaryEntries.summary === undefined
          ? buildSelectedSummary(summaryEntries.items)
          : summaryEntries.summary,
        budget,
      },
      memory: cloneContextMemory(memory),
      imageSelection,
    };

    if (!diagnosticsEnabled) {
      return result;
    }

    return {
      ...result,
      diagnostics: {
        recentTurnsConsidered: selection.consideredCount,
        recentTurnsSelected: selection.selectedDiagnostics,
        mediaEvidenceCandidates: mediaEvidence.candidates,
        factCandidates: importantFacts.candidates,
        summaryCandidates: summaryEntries.candidates,
        budget,
        classification,
        retrievalMode: retrieval.mode,
        retrievalModeReason: retrieval.reason,
        retrievalQueried: retrieval.queried,
        retrievalCandidatesReturned: retrieval.items.length,
        retrievalItemsSelected:
          sameChatRetrieved.items.length + crossChatRetrieved.items.length,
        actualSources: {
          recentTurns: { queried: includeRecentTurns, selected: selection.turns.length },
          imageEvidence: {
            queried: imageEvidenceRepositoryWasQueried(
              classification,
              imageResolution,
              this.sources.evidenceRepository !== undefined,
            ),
            selected: mediaEvidence.items.length,
          },
          retrieval: {
            queried: retrieval.queried,
            selected: sameChatRetrieved.items.length + crossChatRetrieved.items.length,
          },
          durableFacts: {
            queried:
              includeSameChatLongContext && this.sources.listDurableFacts !== undefined,
            selected: importantFacts.items.length,
          },
          summary: {
            queried:
              includeSameChatLongContext && this.sources.getNewestReadySummary !== undefined,
            selected: summaryEntries.summary === undefined
              ? summaryEntries.items.length
              : summaryEntries.summary === null ? 0 : 1,
          },
        },
        proposedRouting: proposedRoutingDiagnostic(classification),
        imageDecision: imageSelection?.decision ?? 'not-applicable',
        imageReferenceAmbiguous: classification.imageReferenceAmbiguous,
        imageReferenceResolution: referenceResolution.resolution,
        crossChatActive: crossChatQueried,
        crossChatQueried,
        crossChatItemsSelected,
        estimatedPromptTokens: null,
        finalNativePromptTokens: null,
        groundingVerdict: null,
      },
    };
  }

  private resolveImageReference(
    snapshot: CanonicalConversationSnapshot,
    classification: RequestClassification,
  ): {
    classification: RequestClassification;
    resolution: ImageReferenceResolution;
  } {
    if (classification.isNewImageQuestion) {
      return { classification, resolution: 'new-image' };
    }
    if (classification.isOlderImageReference) {
      return { classification, resolution: 'explicit-ordinal' };
    }
    if (!classification.imageReferenceAmbiguous) {
      return {
        classification,
        resolution: classification.isSameImageFollowUp
          ? 'active-image'
          : 'not-applicable',
      };
    }

    const candidates = mergeImageReferenceCandidates(
      snapshotImageReferenceCandidates(snapshot),
      this.sources.evidenceRepository?.listImageReferenceCandidates?.(
        snapshot.conversationId,
      ) ?? [],
    );
    const match = resolveDescriptiveImageReference(
      snapshot.currentMessage.text,
      candidates,
    );
    if (match.kind !== 'unique') {
      return { classification, resolution: 'ambiguous-active-fallback' };
    }
    const activeImageId = candidates[candidates.length - 1]?.imageAssetId ?? null;
    const isOlder = match.candidate.imageAssetId !== activeImageId;
    return {
      classification: {
        ...classification,
        isSameImageFollowUp: !isOlder,
        isOlderImageReference: isOlder,
        referencedImageId: isOlder ? match.candidate.imageAssetId : null,
        imageReferenceAmbiguous: false,
      },
      resolution: 'unique-description',
    };
  }

  private resolveImageSelection(
    snapshot: CanonicalConversationSnapshot,
    classification: RequestClassification,
    options: ContextOrchestrationOptions,
  ): {
    selection: ImageSelectionResult;
    evidence: VisualEvidenceRow | null;
    memoryEvidence: ContextMediaEvidence | null;
  } | null {
    const target = resolveImageTarget(snapshot, classification);
    if (target === null) {
      return null;
    }
    const repository = this.sources.evidenceRepository;
    const evidence = classification.isOlderImageReference
      ? repository?.resolveReferencedImageEvidence({
          conversationId: snapshot.conversationId,
          imageAssetId: classification.referencedImageId ?? undefined,
        }) ?? null
      : classification.isNewImageQuestion
        ? null
        : repository?.getActiveImageEvidence(snapshot.conversationId) ?? null;
    const legacyEvidence =
      evidence === null && options.referencedImage !== undefined && repository !== undefined
        ? repository.resolveReferencedImageEvidence({
            conversationId: snapshot.conversationId,
            ...options.referencedImage,
          })
        : evidence;
    const memoryEvidence = findMemoryEvidence(
      snapshot.contextMemory?.mediaEvidence ?? [],
      target.imageAssetId,
      target.sourceMessageId,
    );
    const decision = evaluateImageEvidenceAvailability({
      assetAvailable: target.available,
      hasEvidence: legacyEvidence !== null || memoryEvidence !== null,
      pixelDependent: classification.isPixelDependent,
    }).kind;

    return {
      selection: {
        decision,
        imageAssetId: target.imageAssetId,
        sourceMessageId: target.sourceMessageId,
        originalPath: target.path,
      },
      evidence: decision === 'use-evidence' ? legacyEvidence : null,
      memoryEvidence: decision === 'use-evidence' ? memoryEvidence : null,
    };
  }

  private resolvePersistedEvidence(
    conversationId: string,
    query: string,
    isActiveImageTurn: boolean,
    options: ContextOrchestrationOptions,
  ): VisualEvidenceRow | null {
    const repository = this.sources.evidenceRepository;
    if (repository === undefined) {
      return null;
    }
    const evidence = options.referencedImage === undefined
      ? repository.getActiveImageEvidence(conversationId)
      : repository.resolveReferencedImageEvidence({ conversationId, ...options.referencedImage });
    if (evidence === null || options.referencedImage !== undefined) {
      return evidence;
    }
    return isMediaEvidenceRelevant(visualEvidenceRowToContext(evidence), query, isActiveImageTurn)
      ? evidence
      : null;
  }

  private retrieve(
    snapshot: CanonicalConversationSnapshot,
    conversationIds: readonly string[],
    limit: number,
    options: ContextOrchestrationOptions,
  ): RetrievalExecution {
    const retriever = this.sources.retriever;
    const manifest = this.sources.retrievalManifest;
    if (retriever === undefined || limit <= 0) {
      return {
        items: [],
        mode: 'none',
        reason: retriever === undefined ? 'retriever-unavailable' : 'retrieval-limit-zero',
        queried: false,
      };
    }
    const input = {
      query: snapshot.currentMessage.text,
      queryVector: options.queryVector,
      conversationIds,
      embeddingVersion: manifest?.embeddingVersion ?? '',
      artifactHash: manifest?.artifactHash ?? '',
      limit,
      lexicalCandidates: this.sources.listLexicalCandidates?.(conversationIds) ?? [],
    };
    const detailed = retriever.searchWithDiagnostics?.(input);
    const items = detailed?.items ?? retriever.search(input);
    const mode = detailed?.mode
      ?? (options.queryVector === undefined ? 'lexical-fallback' : 'fused');
    return {
      items,
      mode,
      reason: mode === 'lexical-fallback'
        ? items.length > 0
          ? 'semantic-inactive-candidates-returned'
          : 'semantic-inactive-no-candidate'
        : items.length > 0
          ? 'hybrid-candidates-returned'
          : 'hybrid-no-candidate',
      queried: true,
    };
  }
}

export function resolveCrossChatConversationIds(
  currentConversationId: string,
  enabled: boolean,
  currentConversationExcluded: boolean,
  eligibleConversationIds: readonly string[],
): string[] {
  if (!enabled || currentConversationExcluded) {
    return [currentConversationId];
  }
  return [
    currentConversationId,
    ...eligibleConversationIds.filter((id, index) =>
      id !== currentConversationId
      && eligibleConversationIds.indexOf(id) === index,
    ),
  ];
}

export type { RequestClassification } from './RequestClassifier';

interface ResolvedImageTarget {
  readonly imageAssetId: string | null;
  readonly sourceMessageId: string;
  readonly path: string;
  readonly available: boolean;
}

interface RetrievalExecution {
  readonly items: RetrievedItem[];
  readonly mode: RetrievalMode;
  readonly reason: string;
  readonly queried: boolean;
}

function skippedRetrieval(reason: string): RetrievalExecution {
  return { items: [], mode: 'none', reason, queried: false };
}

function policyOverhead(policy: ContextBudgetPolicy): number {
  return policy instanceof TokenContextBudgetPolicy
    ? TURN_ROLE_OVERHEAD_TOKENS
    : TURN_ROLE_OVERHEAD_UNITS;
}

function imageEvidenceRepositoryWasQueried(
  classification: RequestClassification,
  imageResolution: unknown,
  repositoryAvailable: boolean,
): boolean {
  if (!repositoryAvailable) {
    return false;
  }
  if (imageResolution === null) {
    return false;
  }
  return !classification.isNewImageQuestion;
}

function resolveImageTarget(
  snapshot: CanonicalConversationSnapshot,
  classification: RequestClassification,
): ResolvedImageTarget | null {
  if (classification.isNewImageQuestion) {
    const attachment = snapshot.currentMessage.attachments.find(
      (candidate) => candidate.kind === 'image',
    );
    return attachment === undefined
      ? null
      : {
          imageAssetId: attachment.imageAssetId ?? null,
          sourceMessageId: snapshot.currentMessage.id,
          path: attachment.path,
          available: attachment.available !== false,
        };
  }

  const priorTargets = snapshot.priorMessages.flatMap((message) =>
    message.attachments
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => ({
        imageAssetId: attachment.imageAssetId ?? null,
        sourceMessageId: message.id,
        path: attachment.path,
        available: attachment.available !== false,
      })),
  );
  if (classification.isOlderImageReference) {
    return priorTargets.find(
      (target) =>
        target.imageAssetId === classification.referencedImageId ||
        target.path === classification.referencedImageId,
    ) ?? null;
  }
  if (classification.isSameImageFollowUp || classification.isPixelDependent) {
    return priorTargets[priorTargets.length - 1] ?? null;
  }
  return null;
}

function findMemoryEvidence(
  evidence: readonly ContextMediaEvidence[],
  imageAssetId: string | null,
  sourceMessageId: string,
): ContextMediaEvidence | null {
  return evidence.find(
    (item) =>
      item.sourceMessageId === sourceMessageId ||
      (imageAssetId !== null && item.sourcePath === imageAssetId),
  ) ?? null;
}

function snapshotImageReferenceCandidates(
  snapshot: CanonicalConversationSnapshot,
): ImageReferenceCandidate[] {
  const imageMessageIndexes = snapshot.priorMessages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => messageHasImage(message));
  return imageMessageIndexes.flatMap(({ message, index }, imageIndex) => {
    const attachment = message.attachments.find((candidate) => candidate.kind === 'image');
    if (attachment === undefined) {
      return [];
    }
    const nextImageMessageIndex =
      imageMessageIndexes[imageIndex + 1]?.index ?? snapshot.priorMessages.length;
    const associatedText = snapshot.priorMessages
      .slice(index, nextImageMessageIndex)
      .map((associatedMessage) => associatedMessage.text);
    const memoryText = (snapshot.contextMemory?.mediaEvidence ?? [])
      .filter(
        (evidence) =>
          evidence.sourceMessageId === message.id ||
          evidence.sourcePath === attachment.imageAssetId ||
          evidence.sourcePath === attachment.path,
      )
      .map(formatMediaEvidence);
    return [{
      imageAssetId: attachment.imageAssetId ?? attachment.path,
      sourceMessageId: message.id,
      localPath: attachment.path,
      available: attachment.available !== false,
      createdAt: message.createdAt,
      searchText: [...associatedText, ...memoryText].join('\n'),
    }];
  });
}

function mergeImageReferenceCandidates(
  snapshotCandidates: readonly ImageReferenceCandidate[],
  repositoryCandidates: readonly ImageReferenceCandidate[],
): ImageReferenceCandidate[] {
  const merged = new Map<string, ImageReferenceCandidate>();
  for (const candidate of [...snapshotCandidates, ...repositoryCandidates]) {
    const existing = merged.get(candidate.imageAssetId);
    merged.set(
      candidate.imageAssetId,
      existing === undefined
        ? candidate
        : {
            ...candidate,
            searchText: `${existing.searchText}\n${candidate.searchText}`,
            available: existing.available && candidate.available,
            createdAt: Math.min(existing.createdAt, candidate.createdAt),
          },
    );
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.createdAt - right.createdAt ||
      left.imageAssetId.localeCompare(right.imageAssetId),
  );
}

function proposedRoutingDiagnostic(
  classification: RequestClassification,
): ProposedRoutingDiagnostic {
  const wouldSkipRetrieval =
    classification.isIndependentTextQuestion &&
    !classification.isNewImageQuestion &&
    !classification.isLongContextRetrievalRequest;
  return {
    wouldSkipRetrieval,
    reason: wouldSkipRetrieval
      ? 'phase-3-independent-question'
      : 'classification-requires-context',
  };
}

export function createCanonicalConversationSnapshot(
  conversation: Conversation,
  currentUserMessageId: string,
): CanonicalConversationSnapshot {
  const currentIndex = conversation.messages.findIndex(
    (message) => message.id === currentUserMessageId,
  );
  const currentMessage = conversation.messages[currentIndex];
  if (currentIndex < 0 || currentMessage?.role !== 'user') {
    throw new Error(`User conversation message not found: ${currentUserMessageId}`);
  }

  return {
    version: 'canonical-conversation-snapshot-v1',
    conversationId: conversation.id,
    priorMessages: conversation.messages.slice(0, currentIndex).map(cloneConversationMessage),
    currentMessage: cloneConversationMessage(currentMessage),
    contextMemory: cloneContextMemoryOrNull(conversation.contextMemory),
  };
}

export function mergeVisualEvidenceIntoMemory(
  memory: ConversationContextMemory | null | undefined,
  evidence: HiddenVisualEvidence,
  sourceMessageId: string,
): ConversationContextMemory {
  const base = cloneContextMemoryOrNull(memory) ?? emptyContextMemory();
  const mapped: ContextMediaEvidence = {
    version: 'context-media-evidence-v1',
    id: `${sourceMessageId}:image`,
    sourceMessageId,
    modality: 'image',
    sourcePath: evidence.imagePath,
    summary: evidence.subjectObject,
    facts: [...evidence.visibleFeatures, evidence.visibleCondition].filter(isNonEmptyString),
    extractedText: evidence.visibleText.filter(isNonEmptyString),
    uncertainty: evidence.uncertainty.filter(isNonEmptyString),
    createdAt: parseEvidenceTimestamp(evidence.createdAt),
  };

  return mergeMediaEvidenceIntoMemory(base, mapped);
}

export function mergeMediaEvidenceIntoMemory(
  memory: ConversationContextMemory | null | undefined,
  evidence: ContextMediaEvidence,
): ConversationContextMemory {
  const base = cloneContextMemoryOrNull(memory) ?? emptyContextMemory();
  return {
    ...base,
    mediaEvidence: [
      ...base.mediaEvidence.filter((item) => item.id !== evidence.id),
      cloneMediaEvidence(evidence),
    ],
  };
}

export function formatMediaEvidence(evidence: ContextMediaEvidence): string {
  const lines = [`${evidence.modality}: ${evidence.summary}`];
  if (evidence.facts.length > 0) {
    lines.push(`Details: ${evidence.facts.join('; ')}`);
  }
  if (evidence.extractedText.length > 0) {
    lines.push(`Extracted text: ${evidence.extractedText.join('; ')}`);
  }
  if (evidence.uncertainty.length > 0) {
    lines.push(`Uncertainty: ${evidence.uncertainty.join('; ')}`);
  }
  return lines.join('\n');
}

export function formatMemoryFact(fact: ContextMemoryFact): string {
  return fact.text;
}

export function formatSummaryEntry(entry: ContextSummaryEntry): string {
  return entry.text;
}

function selectRecentTurns(
  turns: ReadonlyArray<ConversationTurn>,
  initialUsedUnits: number,
  policy: ContextBudgetPolicy,
  collectDiagnostics: boolean,
): {
  turns: CanonicalContextTurn[];
  usedUnits: number;
  consideredCount: number;
  selectedDiagnostics: RecentTurnDiagnostic[];
} {
  const selected: CanonicalContextTurn[] = [];
  const selectedDiagnostics: RecentTurnDiagnostic[] = [];
  let usedUnits = initialUsedUnits;
  const candidates = policy.recentExactTurnLimit === 0
    ? []
    : turns.slice(-policy.recentExactTurnLimit);

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const turn = candidates[index];
    const cost =
      policy.measure(turn.question) +
      policy.measure(turn.answer ?? '') +
      policyOverhead(policy);
    if (usedUnits + cost > policy.maximumUnits) {
      continue;
    }
    selected.unshift({ question: turn.question, answer: turn.answer });
    usedUnits += cost;
    if (collectDiagnostics) {
      selectedDiagnostics.unshift({
        sourceUserMessageId: turn.userMessageId,
        sourceAssistantMessageId: turn.assistantMessageId,
        costUnits: cost,
        createdAt: turn.createdAt,
      });
    }
  }

  return { turns: selected, usedUnits, consideredCount: candidates.length, selectedDiagnostics };
}

function responseModeBudgetPolicy(
  base: ContextBudgetPolicy,
  mode: ResponseMode,
  currentRequest: string,
  hasImage: boolean,
): ContextBudgetPolicy {
  const config = getResponseModeConfig(mode);
  const buckets = getContextCapacityBuckets(
    mode,
    currentRequest,
    hasImage,
    config.contextBudgetUnits,
  );
  const options = {
    maximumUnits: base instanceof TokenContextBudgetPolicy
      ? buckets.selectedContext
      : Math.min(base.maximumUnits, buckets.selectedContext),
    recentExactTurnLimit: base instanceof TokenContextBudgetPolicy
      ? config.recentExactTurns
      : Math.min(base.recentExactTurnLimit, config.recentExactTurns),
    maxMediaEvidenceItems: base.maxMediaEvidenceItems,
    maxFactItems: base.maxFactItems,
    maxSummaryEntries: base.maxSummaryEntries,
  };
  return base instanceof TokenContextBudgetPolicy
    ? new TokenContextBudgetPolicy(options)
    : new CharacterContextBudgetPolicy(options);
}

function responseModeLimit(mode: ResponseMode | undefined): number {
  const config = getResponseModeConfig(mode ?? 'Medium');
  return config.sameChatRetrievalLimit;
}

function selectProtectedEvidence(
  row: VisualEvidenceRow,
  initialUsedUnits: number,
  policy: ContextBudgetPolicy,
  collectDiagnostics: boolean,
): {
  items: ContextMediaEvidence[];
  usedUnits: number;
  candidates: RankedCandidateDiagnostic[];
} {
  const item = fitProtectedEvidenceToBudget(
    visualEvidenceRowToContext(row),
    Math.max(0, policy.maximumUnits - initialUsedUnits),
    policy,
  );
  const cost = policy.measure(formatMediaEvidence(item)) + policyOverhead(policy);
  const usedUnits = Math.min(policy.maximumUnits, initialUsedUnits + cost);
  return {
    items: [item],
    usedUnits,
    candidates: collectDiagnostics
      ? [{
          stableId: item.id, relevance: 1, createdAt: item.createdAt, selected: true,
          exclusionReason: null, preview: truncatePreview(formatMediaEvidence(item)),
        }]
      : [],
  };
}

function selectProtectedContextEvidence(
  item: ContextMediaEvidence,
  initialUsedUnits: number,
  policy: ContextBudgetPolicy,
  collectDiagnostics: boolean,
): {
  items: ContextMediaEvidence[];
  usedUnits: number;
  candidates: RankedCandidateDiagnostic[];
} {
  const fitted = fitProtectedEvidenceToBudget(
    item,
    Math.max(0, policy.maximumUnits - initialUsedUnits),
    policy,
  );
  const cost = policy.measure(formatMediaEvidence(fitted)) + policyOverhead(policy);
  return {
    items: [fitted],
    usedUnits: Math.min(policy.maximumUnits, initialUsedUnits + cost),
    candidates: collectDiagnostics
      ? [{
          stableId: fitted.id,
          relevance: 1,
          createdAt: fitted.createdAt,
          selected: true,
          exclusionReason: null,
          preview: truncatePreview(formatMediaEvidence(fitted)),
        }]
      : [],
  };
}

function fitProtectedEvidenceToBudget(
  item: ContextMediaEvidence,
  availableUnits: number,
  policy: ContextBudgetPolicy,
): ContextMediaEvidence {
  const fullCost = policy.measure(formatMediaEvidence(item)) + policyOverhead(policy);
  if (fullCost <= availableUnits) {
    return cloneMediaEvidence(item);
  }

  const formatted = formatMediaEvidence(item);
  const marker = '\n[… protected evidence shortened …]\n';
  let low = 0;
  let high = formatted.length;
  let best = '';
  while (low <= high) {
    const keep = Math.floor((low + high) / 2);
    const head = Math.ceil(keep / 2);
    const tail = keep - head;
    const compacted = keep >= formatted.length
      ? formatted
      : `${formatted.slice(0, head)}${marker}${formatted.slice(formatted.length - tail)}`;
    const candidate = {
      ...item,
      summary: compacted,
      facts: [],
      extractedText: [],
      uncertainty: [],
    };
    const cost = policy.measure(formatMediaEvidence(candidate)) + policyOverhead(policy);
    if (cost <= availableUnits) {
      best = compacted;
      low = keep + 1;
    } else {
      high = keep - 1;
    }
  }

  return {
    ...item,
    summary: best,
    facts: [],
    extractedText: [],
    uncertainty: [],
  };
}

function emptyMediaEvidenceSelection(initialUsedUnits: number): {
  items: ContextMediaEvidence[];
  usedUnits: number;
  candidates: RankedCandidateDiagnostic[];
} {
  return { items: [], usedUnits: initialUsedUnits, candidates: [] };
}

function visualEvidenceRowToContext(row: VisualEvidenceRow): ContextMediaEvidence {
  return {
    version: 'context-media-evidence-v1',
    id: row.id,
    sourceMessageId: row.source_message_id,
    modality: 'image',
    sourcePath: row.image_asset_id,
    summary: row.subject_object,
    facts: parseStringArray(row.visible_features_json),
    extractedText: parseStringArray(row.visible_text_json),
    uncertainty: [row.visible_condition, ...parseStringArray(row.uncertainty_json)]
      .filter(isNonEmptyString),
    createdAt: row.created_at,
  };
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
}

function selectRetrievedWithinBudget(
  retrieved: readonly RetrievedItem[],
  initialUsedUnits: number,
  policy: ContextBudgetPolicy,
): { items: ContextMemoryFact[]; usedUnits: number } {
  const items: ContextMemoryFact[] = [];
  let usedUnits = initialUsedUnits;
  for (const item of retrieved) {
    const sourceKind = 'Untrusted source';
    const text =
      `[${sourceKind}: conversation ${item.sourceConversationId}, message ${item.sourceMessageId}] ` +
      item.text;
    const cost = policy.measure(text) + policyOverhead(policy);
    if (usedUnits + cost > policy.maximumUnits) {
      continue;
    }
    items.push({
      version: 'context-memory-fact-v1',
      id: `retrieved:${item.sourceConversationId}:${item.id}`,
      sourceMessageId: item.sourceMessageId,
      text,
      createdAt: item.timestamp,
    });
    usedUnits += cost;
  }
  return { items, usedUnits };
}

function selectSummaryWithinBudget(
  summary: string | null,
  initialUsedUnits: number,
  policy: ContextBudgetPolicy,
): {
  items: ContextSummaryEntry[];
  summary: string | null;
  usedUnits: number;
  candidates: RankedCandidateDiagnostic[];
} {
  if (summary === null) {
    return { items: [], summary: null, usedUnits: initialUsedUnits, candidates: [] };
  }
  const cost = policy.measure(summary) + policyOverhead(policy);
  if (initialUsedUnits + cost > policy.maximumUnits) {
    return { items: [], summary: null, usedUnits: initialUsedUnits, candidates: [] };
  }
  return { items: [], summary, usedUnits: initialUsedUnits + cost, candidates: [] };
}

function rebuildDerivedMemory(
  snapshot: CanonicalConversationSnapshot,
  olderTurns: ReadonlyArray<ConversationTurn>,
): ConversationContextMemory {
  const validSourceIds = new Set(
    snapshot.priorMessages
      .filter((message) => message.role === 'user')
      .map((message) => message.id),
  );
  const mediaEvidence = (snapshot.contextMemory?.mediaEvidence ?? [])
    .filter((item) => validSourceIds.has(item.sourceMessageId))
    .map(cloneMediaEvidence);
  const entries = olderTurns.map(turnToSummaryEntry);
  const rollingSummary: ContextRollingSummary | null = entries.length === 0
    ? null
    : {
        version: 'rolling-summary-v1',
        coveredThroughMessageId: olderTurns[olderTurns.length - 1].assistantMessageId,
        sourceMessageIds: olderTurns.flatMap((turn) => [
          turn.userMessageId,
          turn.assistantMessageId,
        ]),
        entries,
      };

  return {
    version: 'conversation-context-memory-v1',
    sourceMessageCount: snapshot.priorMessages.length,
    rollingSummary,
    importantFacts: olderTurns.flatMap(turnToFacts),
    mediaEvidence,
  };
}

function conversationTurnsFromMessages(
  messages: ReadonlyArray<ConversationMessage>,
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (
      user?.role === 'user' &&
      assistant?.role === 'assistant'
    ) {
      turns.push({
        userMessageId: user.id,
        assistantMessageId: assistant.id,
        question: user.text.trim(),
        answer: assistant.status === 'completed' ? assistant.text.trim() : null,
        createdAt: assistant.createdAt,
      });
      index += 1;
    }
  }
  return turns;
}

function turnToSummaryEntry(turn: ConversationTurn): ContextSummaryEntry {
  const assistantSummary = turn.answer !== null && isUsableDerivedMemoryAnswer(turn.answer)
    ? `\nLocra: ${compactText(turn.answer, 280)}`
    : '';
  return {
    version: 'context-summary-entry-v1',
    sourceUserMessageId: turn.userMessageId,
    sourceAssistantMessageId: turn.assistantMessageId,
    text: `User: ${compactText(turn.question, 180)}${assistantSummary}`,
    createdAt: turn.createdAt,
  };
}

function turnToFacts(turn: ConversationTurn): ContextMemoryFact[] {
  const sourceText = turn.answer !== null && isUsableDerivedMemoryAnswer(turn.answer)
    ? `${turn.question} ${turn.answer}`
    : turn.question;
  return splitUserMemoryCandidates(sourceText)
    .slice(0, 3)
    .map((text, index) => ({
      version: 'context-memory-fact-v1',
      id: `${turn.userMessageId}:fact:${index}`,
      sourceMessageId: turn.userMessageId,
      text,
      createdAt: turn.createdAt,
    }));
}

function isUsableDerivedMemoryAnswer(answer: string): boolean {
  return (
    answer.trim() !== '' &&
    assessAnswerQuality(answer) === 'complete' &&
    !isToolRefusalResponse(answer)
  );
}

function splitUserMemoryCandidates(text: string): string[] {
  return (text.match(/[^\r\n.!?]+[.!?]?/g) ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length >= 12 && !item.endsWith('?'));
}

function rankMediaEvidence(
  evidence: ReadonlyArray<ContextMediaEvidence>,
  query: string,
  isActiveImageTurn: boolean,
): RankedItem<ContextMediaEvidence>[] {
  return rankItems(evidence, query, formatMediaEvidence, (item) => item.createdAt, (item) => item.id)
    .filter(
      (ranked) =>
        ranked.relevance > 0 || isActiveImageTurn || VISUAL_REFERENCE_PATTERN.test(query),
    );
}

/**
 * Image evidence is only pulled in when the turn is actually about an image:
 * explicit visual language, an active image turn (the current message carries an
 * image), or meaningful lexical overlap with the evidence. Bare pronouns no
 * longer qualify.
 */
function isMediaEvidenceRelevant(
  evidence: ContextMediaEvidence,
  query: string,
  isActiveImageTurn: boolean,
): boolean {
  if (isActiveImageTurn || VISUAL_REFERENCE_PATTERN.test(query)) {
    return true;
  }
  return lexicalOverlap(tokenSet(query), tokenSet(formatMediaEvidence(evidence))) > 0;
}

function selectMediaEvidenceWithinBudget(
  evidence: ReadonlyArray<ContextMediaEvidence>,
  query: string,
  isActiveImageTurn: boolean,
  maximumItems: number,
  initialUsedUnits: number,
  policy: ContextBudgetPolicy,
  collectDiagnostics: boolean,
): {
  items: ContextMediaEvidence[];
  usedUnits: number;
  candidates: RankedCandidateDiagnostic[];
} {
  const ranked = rankMediaEvidence(evidence, query, isActiveImageTurn);
  const relevant = ranked.filter((candidate) => candidate.relevance > 0);
  const eligible = relevant.length > 0 ? relevant : ranked.slice(0, 1);
  const selection = selectWithinBudget(
    eligible,
    maximumItems,
    initialUsedUnits,
    policy,
    formatMediaEvidence,
    collectDiagnostics,
  );
  if (!collectDiagnostics || eligible.length === ranked.length) {
    return selection;
  }

  const diagnosticsById = new Map(
    selection.candidates.map((candidate) => [candidate.stableId, candidate]),
  );
  return {
    ...selection,
    candidates: ranked.map(
      (candidate) =>
        diagnosticsById.get(candidate.stableId) ??
        toCandidateDiagnostic(candidate, formatMediaEvidence, false,
          selection.items.length >= maximumItems ? 'item-cap' : 'relevance'),
    ),
  };
}

function rankFacts(
  facts: ReadonlyArray<ContextMemoryFact>,
  query: string,
): RankedItem<ContextMemoryFact>[] {
  return rankItems(facts, query, formatMemoryFact, (item) => item.createdAt, (item) => item.id);
}

function rankSummaryEntries(
  entries: ReadonlyArray<ContextSummaryEntry>,
  query: string,
): RankedItem<ContextSummaryEntry>[] {
  return rankItems(
    entries,
    query,
    formatSummaryEntry,
    (item) => item.createdAt,
    (item) => item.sourceAssistantMessageId,
  );
}

function rankItems<T>(
  items: ReadonlyArray<T>,
  query: string,
  content: (item: T) => string,
  createdAt: (item: T) => number,
  stableId: (item: T) => string,
): RankedItem<T>[] {
  const queryTokens = tokenSet(query);
  return items
    .map((item) => ({
      item,
      relevance: lexicalOverlap(queryTokens, tokenSet(content(item))),
      createdAt: createdAt(item),
      stableId: stableId(item),
    }))
    .sort(compareRankedItems);
}

function compareRankedItems<T>(left: RankedItem<T>, right: RankedItem<T>): number {
  if (left.relevance !== right.relevance) {
    return right.relevance - left.relevance;
  }
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  return left.stableId.localeCompare(right.stableId);
}

function messageHasImage(message: ConversationMessage): boolean {
  return message.attachments.some((attachment) => attachment.kind === 'image');
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !TOKEN_STOP_WORDS.has(token)),
  );
}

function lexicalOverlap(queryTokens: Set<string>, candidateTokens: Set<string>): number {
  let overlap = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function selectWithinBudget<T>(
  ranked: ReadonlyArray<RankedItem<T>>,
  maximumItems: number,
  initialUsedUnits: number,
  policy: ContextBudgetPolicy,
  format: (item: T) => string,
  collectDiagnostics: boolean,
): { items: T[]; usedUnits: number; candidates: RankedCandidateDiagnostic[] } {
  const items: T[] = [];
  const candidates: RankedCandidateDiagnostic[] = [];
  let usedUnits = initialUsedUnits;
  let stopIndex = ranked.length;

  for (let index = 0; index < ranked.length; index += 1) {
    if (items.length >= maximumItems) {
      stopIndex = index;
      break;
    }
    const rankedItem = ranked[index];
    const cost = policy.measure(format(rankedItem.item)) + policyOverhead(policy);
    if (usedUnits + cost > policy.maximumUnits) {
      if (collectDiagnostics) {
        candidates.push(toCandidateDiagnostic(rankedItem, format, false, 'budget'));
      }
      continue;
    }
    items.push(rankedItem.item);
    usedUnits += cost;
    if (collectDiagnostics) {
      candidates.push(toCandidateDiagnostic(rankedItem, format, true, null));
    }
  }

  if (collectDiagnostics) {
    for (let index = stopIndex; index < ranked.length; index += 1) {
      candidates.push(toCandidateDiagnostic(ranked[index], format, false, 'item-cap'));
    }
  }

  return { items, usedUnits, candidates };
}

function toCandidateDiagnostic<T>(
  rankedItem: RankedItem<T>,
  format: (item: T) => string,
  selected: boolean,
  exclusionReason: ContextCandidateExclusionReason | null,
): RankedCandidateDiagnostic {
  return {
    stableId: rankedItem.stableId,
    relevance: rankedItem.relevance,
    createdAt: rankedItem.createdAt,
    selected,
    exclusionReason: selected ? null : exclusionReason,
    preview: truncatePreview(format(rankedItem.item)),
  };
}

function truncatePreview(value: string): string {
  return value.length <= CANDIDATE_PREVIEW_MAX_CHARS
    ? value
    : `${value.slice(0, CANDIDATE_PREVIEW_MAX_CHARS)}…`;
}

function buildSelectedSummary(entries: ReadonlyArray<ContextSummaryEntry>): string | null {
  return entries.length === 0 ? null : entries.map(formatSummaryEntry).join('\n\n');
}

function cloneConversationMessage(message: ConversationMessage): ConversationMessage {
  return {
    ...message,
    attachments: message.attachments.map((attachment) => ({ ...attachment })),
  };
}

function cloneContextTurn(turn: CanonicalContextTurn): CanonicalContextTurn {
  return { question: turn.question, answer: turn.answer };
}

function cloneMediaEvidence(evidence: ContextMediaEvidence): ContextMediaEvidence {
  return {
    ...evidence,
    facts: [...evidence.facts],
    extractedText: [...evidence.extractedText],
    uncertainty: [...evidence.uncertainty],
  };
}

function cloneMemoryFact(fact: ContextMemoryFact): ContextMemoryFact {
  return { ...fact };
}

function cloneSummaryEntry(entry: ContextSummaryEntry): ContextSummaryEntry {
  return { ...entry };
}

function cloneContextMemory(memory: ConversationContextMemory): ConversationContextMemory {
  return {
    version: 'conversation-context-memory-v1',
    sourceMessageCount: memory.sourceMessageCount,
    rollingSummary: memory.rollingSummary === null
      ? null
      : {
          ...memory.rollingSummary,
          sourceMessageIds: [...memory.rollingSummary.sourceMessageIds],
          entries: memory.rollingSummary.entries.map(cloneSummaryEntry),
        },
    importantFacts: memory.importantFacts.map(cloneMemoryFact),
    mediaEvidence: memory.mediaEvidence.map(cloneMediaEvidence),
  };
}

function cloneContextMemoryOrNull(
  memory: ConversationContextMemory | null | undefined,
): ConversationContextMemory | null {
  return memory?.version === 'conversation-context-memory-v1'
    ? cloneContextMemory(memory)
    : null;
}

function emptyContextMemory(): ConversationContextMemory {
  return {
    version: 'conversation-context-memory-v1',
    sourceMessageCount: 0,
    rollingSummary: null,
    importantFacts: [],
    mediaEvidence: [],
  };
}

function compactText(value: string, maximumChars: number): string {
  const normalized = value.trim();
  if (normalized.length <= maximumChars) {
    return normalized;
  }
  const marker = ' [...summary shortened...] ';
  const remaining = maximumChars - marker.length;
  const head = Math.ceil(remaining / 2);
  return `${normalized.slice(0, head).trimEnd()}${marker}${normalized
    .slice(-(remaining - head))
    .trimStart()}`;
}

function parseEvidenceTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNonEmptyString(value: string): boolean {
  return value.trim() !== '';
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(1, Math.floor(value));
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(0, Math.floor(value));
}
