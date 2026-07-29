# Phase 1 Data Model: Context Routing and Answer Quality

This feature extends Spec 006 entities; it does not replace them. Only new or changed shapes are documented below — see `specs/006-hybrid-context-response-voice/data-model.md` for everything unchanged (message, attempt, image asset, evidence, chunk, embedding, summary, fact).

## RequestClassification (historical legacy/shadow adapter)

Computed per request by `RequestClassifier`; not persisted — it is a transient result of one `orchestrate()` call, though it is captured in that turn's diagnostics (see Router Diagnostics below).

| Field | Type | Notes |
|---|---|---|
| `isIndependentTextQuestion` | boolean | Legacy signal only; MUST NOT globally disable FR-086 protected exact/direct sources. |
| `isTextFollowUp` | boolean | Conversational-reference signal detected (pronoun/continuation phrase, or ambiguous-short-reply default). |
| `isNewImageQuestion` | boolean | Current message carries a newly attached image. |
| `isSameImageFollowUp` | boolean | References the conversation's current/active image without a new attachment. |
| `isOlderImageReference` | boolean | Explicitly references an earlier, non-active image; carries a resolved `referencedImageId`. |
| `isPixelDependent` | boolean | OCR/counting/price/detailed-visual-inspection language detected; combinable with any image classification. |
| `isLongContextRetrievalRequest` | boolean | Conversation length exceeds the response mode's recent-turn floor and the request plausibly concerns earlier content. |
| `isCrossChatEligible` | boolean | Cross-chat setting enabled AND current conversation not excluded AND request is otherwise eligible (Phase 7 only; always `false` before Phase 7 ships). |
| `referencedImageId` | string \| null | Set only when `isOlderImageReference` is true and the reference is unambiguous. |
| `imageReferenceAmbiguous` | boolean | Legacy observation that multiple candidates remain plausible; authoritative conversion produces `unresolved-reference`, not `isSameImageFollowUp`. |

**Validation rules**:
- At least one of `isIndependentTextQuestion` / `isTextFollowUp` is always true; they are mutually exclusive with each other (a request is either independent or a follow-up, never both), but each may combine with any image/pixel/long-context/cross-chat flag.
- `isIndependentTextQuestion === true` implies every other flag is `false` except when another classification is *simultaneously and independently* true from its own signal (e.g., a genuinely independent question that also happens to attach a new image is `isIndependentTextQuestion && isNewImageQuestion`) — per spec FR-003's "unless the request also carries another classification" carve-out.
- `referencedImageId` is non-null if and only if `isOlderImageReference` is true.
- `imageReferenceAmbiguous` can only be `true` when image-reference language has multiple materially plausible targets. In shadow mode it records the legacy result without changing execution. In controlled/authoritative mode it maps to an unresolved reference with no selected image.

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
| `retrievalQueried` / returned / selected counts | boolean / number / number | Actual Phase 1 runtime behavior, independent of proposed Phase 3 routing. |
| `actualSources` | object | Per-source queried/considered and selected counts for the current implementation. |
| `proposedRouting` | object | Observation-only prediction such as `wouldSkipRetrieval`; never alters Phase 1 behavior. |
| `imageDecision` | `ImageEvidenceDecision \| 'not-applicable'` | New — the resolved decision for this turn. |
| `imageReferenceAmbiguous` | boolean | `true` when multiple materially plausible image candidates remain. |
| `imageReferenceResolution` | string union | `not-applicable`, `new-image`, `active-image`, `explicit-ordinal`, `unique-description`, `unresolved-reference`, `clarification-required`, `asset-unavailable`; never an ambiguity-to-active fallback. |
| `authorityMode` | `shadow \| controlled \| authoritative` | Required on every new record. |
| `planOwner` | stable string | Exact semantic authority, e.g. `legacy-router-v1` or `turn-planner:<version>`. |
| `constrainedPlanner` | object | Invocation/gate reason, queue wait, execution latency, result status, confidence, and fallback; required even when `invoked: false`. |
| `crossChatActive` | boolean | Reflects whether an enabled, non-excluded cross-chat scope was actually queried for this turn; otherwise `false`. |
| `groundingVerdict` | `'supported' \| 'unsupported' \| null` | Phase 8 diagnostics-only result; `null` when the turn did not include image evidence or retrieved text that can be assessed (spec FR-040). |

**Validation rules**:
- `retrievalMode` and `imageDecision` MUST be present on every turn's diagnostics once Phase 1 ships, even when the value is `'none'`/`'not-applicable'` (spec FR-037 requires recording consideration, not just selection).
- Older pre-Phase-8 diagnostic records MAY omit `groundingVerdict`; current records use
  `null` when grounding assessment is not applicable (spec FR-040).

## Architecture Revision Entities (2026-07-28, authoritative)

The entities below supersede `RequestClassification` as the authoritative
semantic model. The existing classification shape may remain during shadow
migration only.

## TurnPlan

Transient, validated per turn, and persisted only as sanitized diagnostics/audit
state as required by rollout. Exact implementation names may change without
changing these semantics.

| Field | Type | Validation |
|---|---|---|
| `planVersion` | string | MVP; schema/policy version. |
| `turnId` | string | MVP; stable canonical turn/action link. |
| `authorityMode` | `shadow \| controlled \| authoritative` | MVP; execution ownership semantics. |
| `planOwner` | stable string | MVP; exact semantic owner. |
| `intent` | `answer \| compare \| transform \| recall \| remember \| inspect \| extract \| retry \| regenerate \| continue \| clarify` | MVP primary task kind. |
| `modality` | `text \| image \| multimodal` | MVP; must match required inputs/provider capability. |
| `conversationDependency` | `none \| recent \| ledger \| retrieval \| mixed \| unresolved` | MVP with evidence codes. |
| `references` | `ResolvedReference[]` | MVP; target type/ID, resolution code, confidence. |
| `unresolvedReferences` | `UnresolvedReference[]` | MVP; candidate IDs, reason, clarification flag; no selected target. |
| `requiredContextSources` | `ContextSourceRequirement[]` | MVP; independently required/optional, reason, provenance. |
| `memoryReads` | `MemoryReadRequirement[]` | MVP; query/scope/required status. |
| `memoryWrites` | `MemoryWriteRequirement[]` | MVP; explicit status, fact payload, scope, provenance; uncertain durable writes forbidden. |
| `vision` | `VisionExecutionPlan` | MVP; exactly one strategy. |
| `generationTaskKind` | `answer \| comparison \| extraction \| clarification \| continuation \| refusal-recovery` | MVP. |
| `confidence` | `PlanningConfidence` | MVP overall and unresolved-field confidence. |
| `fallback` | `execute \| clarify-reference \| lexical-only \| asset-unavailable \| capability-unavailable \| cancelled` | MVP deterministic fallback. |
| `activeEntityIds` / `activeTopics` | typed arrays | Optional later enrichment; ledger remains source. |
| `retrievalRankingHints` / `outputFormat` / `planningSignals` | typed values | Optional later enrichment; never a second authority. |

**Validation rules**:

- One validated plan exists before downstream semantic execution.
- A missing/low-confidence field does not remove unrelated required fields.
- Required image modality identifies available image entities or produces an
  unresolved/asset-unavailable fallback; never silent text-only.
- Multiple plausible image references never select one without a uniquely
  supported resolution.
- Continue/retry/regenerate action semantics link to the prior plan/attempt.

## AuthorityMode / PlanOwner

| Mode | `planOwner` | Execution |
|---|---|---|
| `shadow` | `legacy-router:<version>` | Legacy executes the whole turn; new plan is diagnostics-only. |
| `controlled` | `turn-planner:<version>` for an explicitly enabled class | New plan executes the whole turn; legacy is full-turn rollback only. |
| `authoritative` | `turn-planner:<version>` | New plan executes all supported turns; legacy semantics are not consulted. |

One turn cannot contain more than one semantic `planOwner`.

## ConstrainedPlanningResolution

Tier 3 returns only requested unresolved fields:

| Field | Type | Validation |
|---|---|---|
| `candidateReferenceIdsReceived` | ordered ID list | Exact match to deterministic input list. |
| `selectedReferenceIds` | ID list | Subset of candidates, or empty when unresolved. |
| `referenceStatus` | `resolved \| unresolved` | `resolved` requires uniquely valid selection. |
| `intentClarification` | nullable MVP intent | Present only when requested. |
| `memoryInterpretation` | `read \| write \| neither \| unresolved` | Cannot create a write without validated user factual content/scope. |
| `requestedContextScope` | `current-turn \| recent \| same-chat \| cross-chat \| unresolved` | Cross-chat still obeys settings/exclusions. |
| `confidence` | number `[0,1]` | Initial acceptance threshold is `0.80`. |
| `rationaleCodes` | bounded enum list | Only codes in the unified-planning contract. |
| `clarificationRequired` | boolean | Required for unresolved target/write ambiguity. |

The output cannot add candidate IDs or replace fields already resolved by
deterministic tiers. Diagnostics record invocation, gate reason, queue wait,
execution latency, validation result, and fallback.

## ConversationStateLedger

Derived per conversation; canonical messages remain authoritative.

| Field | Type | Notes |
|---|---|---|
| `conversation_id` | stable ID | Parent; cascades on conversation delete. |
| `schema_version` | string | Persisted-cache compatibility key. |
| `revision` | integer | Increments on derived-state update/rebuild. |
| `active_topics` | typed list | Topic identity, aliases, confidence, source message IDs. |
| `active_entities` | typed list | Entity identity/type/aliases and source message IDs. |
| `comparison_target_ids` | ID list | Ordered current comparison set. |
| `active_image_ids` | image ID list | One or more active images; order is explicit. |
| `referenced_artifact_ids` | ID list | Code blocks and supported document references. |
| `unresolved_references` | typed list | Candidate targets and clarification state. |
| `recent_decisions` | typed list | User-stated/confirmed decisions with provenance. |
| `explicit_memory_write_ids` | ID list | Immediate durable-memory links. |
| `source_message_ids` | ID list | Complete derivation provenance. |
| `updated_at` | timestamp | Derived update time. |
| `source_state_hash` | string | Detects missing/stale cache against canonical messages and structured records. |
| `status` | `ready \| stale \| rebuilding \| corrupt` | Corrupt/stale caches rebuild without modifying canonical history. |

Turn completion ordering is: persist completed canonical turn; derive validated
results; update/rebuild ledger; publish it before the next plan. Invalidation
covers creation, deletion, conversation deletion, retry/regeneration,
superseded attempts, evidence reinference, version changes, and rebuilds.
General message editing is out of scope. Failed, cancelled, interrupted,
refusal-like, superseded, or unsupported attempts establish no trusted fact.

## RetrievalUnit

| Field | Type | Notes |
|---|---|---|
| `id` | stable ID | Stable across index rebuilds; not a vector ID. |
| `conversation_id` | nullable stable ID | Null only for explicitly global local memory if later approved. |
| `source_message_ids` | non-empty ID list | Canonical provenance. |
| `type` | enum | `user-message`, `assistant-answer`, `code-block`, `explicit-memory`, `durable-fact`, `decision`, `summary-segment`, `image-evidence`. |
| `text` | string | Searchable textual representation. |
| `reliability` | `user-direct \| pixel-confirmed \| exact-extracted \| durable-confirmed \| assistant-grounded \| assistant-ordinary \| assistant-uncertain \| ineligible-attempt` | Ordinal; derived from source type/status, never semantic similarity. |
| `source_revision` | string | Content/status/version hash; not a general message-edit feature. |
| `created_at` / `updated_at` | timestamps | Required. |
| `status` | enum | `eligible`, `stale`, `superseded`, `deleted`, `untrusted`. |

Completed assistant answers may be eligible at lower reliability. Failed,
cancelled, interrupted, refusal-like, superseded, or unsupported attempts are
not trusted factual evidence.

## ExplicitMemory

| Field | Type | Notes |
|---|---|---|
| `id` | stable ID | Also represented by a typed retrieval unit. |
| `conversation_id` | stable ID | Source conversation. |
| `source_message_ids` | non-empty ID list | User source provenance. |
| `subject` / `predicate` / `value` | strings | Structured memory content where extraction is reliable. |
| `verbatim_text` | string | Exact lexical fallback. |
| `reliability` | `user-explicit` | Distinct from inferred facts. |
| `source_revision` | revision | Invalidation key. |
| `available_at` | timestamp | Same transaction/workflow completion as source persistence; never compaction-gated. |
| `status` | `active \| superseded \| deleted` | Only active value is returned by default. |
| `supersedes_memory_id` | nullable stable ID | User correction link; both source provenances remain auditable. |

Detection combines user command/action semantics, structured planner output,
deterministic validation, factual payload, and memory-scope settings. Uncertain
interpretation never silently creates a durable row.

## ImageEntity

| Field | Type | Notes |
|---|---|---|
| `id` | stable ID | First-class identity across turns/evidence versions. |
| `source_message_id` | stable ID | Canonical provenance. |
| `asset_revision` | revision | Changes when asset metadata/content changes. |
| `asset_availability` | enum | `available`, `missing`, `deleted`, `unsupported`. |
| `local_asset_reference` | sanitized local reference | Pixels remain canonical local asset, never exported raw by default. |
| `evidence_ids` | ID list | Structured evidence versions. |
| `created_at` / `updated_at` | timestamps | Required. |

## StructuredImageEvidence

| Field | Type | Notes |
|---|---|---|
| `id` | stable versioned ID | Separate from assistant message/answer. |
| `image_id` | stable image ID | Mandatory source identity. |
| `source_message_ids` | ID list | Image turn plus extraction-triggering turn. |
| `summary` | short string | Required MVP scene/evidence summary. |
| `objects` | typed list | Required MVP visible object identities/attributes. |
| `extracted_text` | typed spans | Required MVP text with confidence and optional object association. |
| `numeric_values` | typed list | Required MVP prices, dates, counts, serial-like values, units, confidence, optional object association. |
| `uncertainty` | typed list/score | Evidence-level and field-level uncertainty. |
| `status` | `complete \| partial \| failed \| stale` | Required; malformed/incomplete output is never silently complete. |
| `source_revision` | revision | Image/evidence policy revision key. |
| `created_at` / `updated_at` | timestamps | Required. |

Spatial relationships and full scene-graph fields are optional later
extensions. A text-only formatting retry cannot add new visual facts.

## VisionExecutionPlan

| Strategy | Required behavior |
|---|---|
| `none` | No image/evidence input. |
| `reuse-evidence` | Use eligible structured evidence for identified image entities. |
| `inspect-original` | Inspect identified canonical pixels for this turn. |
| `inspect-and-structure` | Inspect pixels and persist reusable structured evidence. |
| `compare-evidence` | Preserve multiple image/evidence identities and compare without merging provenance. |

Assistant prose, including refusals, is never substituted for canonical pixels
or structured evidence.

## EmbeddingModelDescriptor / EmbeddingIndex

| Field | Type | Notes |
|---|---|---|
| `provider_id` / `model_id` | strings | Model-independent provider identity. |
| `artifact_identity` | string | Approved artifact/hash identity. |
| `dimensions` | integer | Benchmark-selected; at least 256/512 evaluated. |
| `prompt_policy_version` | string | Distinguishes query/document policy. |
| `normalization` | enum | `l2` or `none`. |
| `runtime_compatibility` | string | Runtime/New Architecture/NDK descriptor. |
| `index_version` | string | Side-by-side migration key. |
| `state` | enum | `inactive`, `building`, `ready`, `stale`, `failed`, `retiring`. |
| `progress_cursor` | nullable stable cursor | Restart-safe backfill. |
| `created_at` / `activated_at` | timestamps | Lifecycle audit. |

Each vector additionally stores `retrieval_unit_id`, `source_revision`, model
descriptor identity, index version, and normalized vector data.

## MainModelCapabilities

Transient descriptor supplied by the active main inference provider:

- text generation, image input, and structured extraction support;
- context limit and native tokenizer descriptor;
- generation limits and supported prompt formats;
- projector requirements and runtime compatibility;
- cancellation capability;
- provider/model descriptor safe for internal diagnostics.

Changing this descriptor does not migrate canonical messages, ledger/memory,
retrieval units, image evidence, or embedding indexes.
