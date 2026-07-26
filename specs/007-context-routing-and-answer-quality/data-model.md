# Phase 1 Data Model: Context Routing and Answer Quality

This feature extends Spec 006 entities; it does not replace them. Only new or changed shapes are documented below — see `specs/006-hybrid-context-response-voice/data-model.md` for everything unchanged (message, attempt, image asset, evidence, chunk, embedding, summary, fact).

## RequestClassification (new)

Computed per request by `RequestClassifier`; not persisted — it is a transient result of one `orchestrate()` call, though it is captured in that turn's diagnostics (see Router Diagnostics below).

| Field | Type | Notes |
|---|---|---|
| `isIndependentTextQuestion` | boolean | No conversational-reference signal detected; gates FR-003's zero-context rule. |
| `isTextFollowUp` | boolean | Conversational-reference signal detected (pronoun/continuation phrase, or ambiguous-short-reply default). |
| `isNewImageQuestion` | boolean | Current message carries a newly attached image. |
| `isSameImageFollowUp` | boolean | References the conversation's current/active image without a new attachment. |
| `isOlderImageReference` | boolean | Explicitly references an earlier, non-active image; carries a resolved `referencedImageId`. |
| `isPixelDependent` | boolean | OCR/counting/price/detailed-visual-inspection language detected; combinable with any image classification. |
| `isLongContextRetrievalRequest` | boolean | Conversation length exceeds the response mode's recent-turn floor and the request plausibly concerns earlier content. |
| `isCrossChatEligible` | boolean | Cross-chat setting enabled AND current conversation not excluded AND request is otherwise eligible (Phase 7 only; always `false` before Phase 7 ships). |
| `referencedImageId` | string \| null | Set only when `isOlderImageReference` is true and the reference is unambiguous. |
| `imageReferenceAmbiguous` | boolean | `true` when the request's image reference could plausibly mean more than one prior image with no disambiguating detail; when `true`, `isOlderImageReference` is `false` and `isSameImageFollowUp` is `true` instead (spec FR-012a). |

**Validation rules**:
- At least one of `isIndependentTextQuestion` / `isTextFollowUp` is always true; they are mutually exclusive with each other (a request is either independent or a follow-up, never both), but each may combine with any image/pixel/long-context/cross-chat flag.
- `isIndependentTextQuestion === true` implies every other flag is `false` except when another classification is *simultaneously and independently* true from its own signal (e.g., a genuinely independent question that also happens to attach a new image is `isIndependentTextQuestion && isNewImageQuestion`) — per spec FR-003's "unless the request also carries another classification" carve-out.
- `referencedImageId` is non-null if and only if `isOlderImageReference` is true.
- `imageReferenceAmbiguous` can only be `true` when the request contains image-reference language at all; when `true`, the classifier MUST set `isSameImageFollowUp = true` and `isOlderImageReference = false` (the ambiguous-reference default, spec FR-012a) rather than leaving both `false`.

## TokenBudget / ContextBudgetPolicy (changed)

Replaces `CharacterContextBudgetPolicy` as the concrete implementation the runtime orchestrator uses; the `ContextBudgetPolicy` interface shape (`policyId`, `maximumUnits`, `recentExactTurnLimit`, `maxMediaEvidenceItems`, `maxFactItems`, `maxSummaryEntries`, `measure(content): number`) is unchanged so `ContextOrchestrator`'s existing selection/eviction code keeps working against the interface.

| Field | Type | Notes |
|---|---|---|
| `policyId` | string | New value, e.g. `'token-estimate-budget-v1'`, replacing `'character-budget-v1'`. |
| `maximumUnits` | number | Now a token count (or calibrated token-equivalent) representing the **selected-context pool only** (bucket 4 of 5, see Reserved Capacity Buckets below), not a character count and not the full context window; recalibrated per mode (see `research.md` §1 and Open Questions). |
| `measure(content)` | function | Returns the calibrated token estimate for `content` (tier 1 of `research.md` §1's two-tier approach), not `content.length`. Used during iterative candidate selection; not a live native `tokenize()` call. |

**Reserved Capacity Buckets (spec FR-026a)**: the full per-request token accounting is split into five distinct reservations, not one lump pool:

| Bucket | Owner | Notes |
|---|---|---|
| 1. System instructions | `SystemPrompt.ts` (existing) | Fixed per response mode; measured once, not re-measured per candidate. |
| 2. Current request/input | `ContextOrchestrator` (existing `selectRecentTurns` current-request accounting) | Variable; capped via the existing `capMessageToTokenBudget` shortening path in `ContextWindow` if oversized. |
| 3. Image input | `ContextWindow.IMAGE_RESERVE_TOKENS` (existing constant, currently `768`) | Reserved only when an image is active/referenced for this request; zero otherwise. |
| 4. Selected-context pool | `ContextBudgetPolicy.maximumUnits` (this entity) | Recent turns, facts, summary, and retrieval combined — the only bucket the router's ranking/eviction logic sizes. |
| 5. Generated output | `getResponseGenerationLimit(mode)` (existing) | Hard `n_predict` reserve, unchanged mechanism. |

**Validation rules**:
- `measure()` output for a given string MUST be consistent (deterministic, no randomness) so repeated selection is reproducible (spec FR-006).
- Bucket 4 (`maximumUnits`) MUST be sized so that buckets 1 + 2 + 3 + 4 + 5 never exceed `QWEN_CONTEXT_TOKEN_LIMIT` minus `CONTEXT_SAFETY_TOKENS`; bucket 4 MUST NOT be allowed to grow into headroom reserved for 1, 2, 3, or 5.
- The router's total `usedUnits` for bucket 4 MUST NOT exceed what `ContextWindow`'s downstream hard trim would itself allow for the same response mode once buckets 1/2/3/5 are subtracted — reconciled via the tier-2 final-prompt `tokenize()` check (`research.md` §1), not merely independently bounded (spec FR-027).

## ImageEvidenceDecision (changed)

Extends the existing `ImageEvidenceAvailability` union from `ImageEvidencePolicy.ts`.

| Value | Meaning | Change from Spec 006 |
|---|---|---|
| `use-original` | Original image is re-run through vision inference for this request. | Renamed in spirit (not necessarily in code) to make explicit this now triggers a real inference call producing a new evidence row, not merely "prefer the original" as a label (spec FR-008). |
| `use-evidence` | Existing stored evidence answers the request. | Unchanged. |
| `original-unavailable` | Pixel-dependent request, original missing. | Unchanged. |
| `evidence-unavailable` | Non-pixel-dependent request, both original and evidence missing. | Unchanged. |

**New input field**: `ImageEvidenceAvailabilityInput.pixelDependent` — previously defined but never populated by any caller; now populated by `RequestClassification.isPixelDependent` (spec FR-007).

## CrossChatMemorySetting (new, Phase 7)

Global, MMKV-backed, mirrors the existing `defaultResponseMode` pattern in `settingsStore`.

| Field | Type | Notes |
|---|---|---|
| `crossChatMemoryEnabled` | boolean | Default `false` (spec FR-020). Read by the runtime orchestrator when resolving retrieval scope. |

## Conversation.excluded_from_cross_chat (new column, Phase 7)

Added to the existing `conversation` SQL table via a `Migrations.ts` entry bumping `SCHEMA_VERSION` 3 → 4.

| Column | Type | Notes |
|---|---|---|
| `excluded_from_cross_chat` | `INTEGER NOT NULL DEFAULT 0` | `0`/`1` boolean; `1` means this conversation neither contributes to nor receives cross-chat retrieval (spec FR-021). |

**Validation rules**:
- Existing rows migrate with `excluded_from_cross_chat = 0` (not excluded), preserving current single-chat-only behavior for every existing conversation until a user explicitly excludes one.
- `HybridRetriever`'s cross-chat scope resolution MUST filter out any conversation with `excluded_from_cross_chat = 1` before scoring (scope-before-scoring, spec FR-022).

## RetrievedItem (changed)

Existing shape from `src/retrieval/types.ts` is unchanged in its fields; its *production* changes:

- `score` now reflects the RRF-fused score (§3 in `research.md`) when both lexical and semantic candidates exist, rather than a bare cosine similarity or bare lexical-overlap count.
- A new internal `fusionSources: ('lexical' | 'semantic')[]` MAY be attached at the retriever layer for diagnostics purposes (not required on the persisted/consumed type, only on the diagnostic candidate record below).
- A new internal `exactMatchGuaranteed: boolean` MAY be attached at the retriever layer to mark a result that was retained by the exact-match guarantee (spec FR-019a) rather than by its RRF rank alone — diagnostics-visible only, not part of the persisted item.

## RankedCandidateDiagnostic (changed, Router Diagnostics)

Extends the existing `ContextSelectionDiagnostics`/`RankedCandidateDiagnostic` shapes from `ContextOrchestrator.ts`.

| Field | Type | Notes |
|---|---|---|
| `classification` | `RequestClassification` | New — recorded once per turn (not per candidate) alongside the existing `budget` field. |
| `retrievalMode` | `'fused' \| 'lexical-fallback' \| 'none'` | New — which retrieval state (spec FR-013) was actually used for this turn, plus a `retrievalModeReason` string (e.g. `'embeddings-stale'`, `'below-threshold'`, `'no-candidate'`). |
| `imageDecision` | `ImageEvidenceDecision \| 'not-applicable'` | New — the resolved decision for this turn. |
| `imageReferenceAmbiguous` | boolean | New — mirrors `RequestClassification.imageReferenceAmbiguous`; `true` when an ambiguous reference was defaulted to the active image (spec FR-012a, FR-037). |
| `crossChatActive` | boolean | New — `false` until Phase 7 ships; thereafter reflects whether cross-chat scope was used for this turn. |
| `groundingVerdict` | `'supported' \| 'unsupported' \| null` | New, Phase 8 only — `null`/omitted until Phase 8 ships (spec FR-040). |

**Validation rules**:
- `retrievalMode` and `imageDecision` MUST be present on every turn's diagnostics once Phase 1 ships, even when the value is `'none'`/`'not-applicable'` (spec FR-037 requires recording consideration, not just selection).
- `groundingVerdict` MUST be omittable (not merely `null`) before Phase 8 ships without diagnostics being considered incomplete (spec FR-040).
