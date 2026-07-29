# Implementation Plan: Context Routing and Answer Quality

**Branch**: `007-context-routing-and-answer-quality` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-context-routing-and-answer-quality/spec.md`

## Summary

**Architecture revision (2026-07-28, authoritative)**: Migrate from the
implemented regex-led `RequestClassification` architecture to one validated
`TurnPlan` per turn. The plan coordinates conversation state, memory,
retrieval, vision, generation, queue dispatch, refusal recovery, and grounding.
Introduce model-independent boundaries for EmbeddingGemma-backed semantic
signals and the unchanged current Qwen3-VL main provider. Preserve the current
implementation in shadow mode until golden scenarios and physical diagnostics
justify authority transfer. The original summary below describes the
implemented legacy baseline and is retained for historical task traceability.

Extend Spec 006's `ContextOrchestrator` with a deterministic request-classification step (8 combinable categories) so independent, self-contained questions receive zero unrelated context, wire the already-built-but-inert pieces (`ImageEvidencePolicy`, query-time embeddings, `HybridRetriever` fusion) into the live path, replace the router's character-based budget with a token-aware one reconciled against the existing hard `ContextWindow` trim, and improve generation quality (task-sensitive length targets, earlier in-stream loop stopping) — all as incremental changes to existing modules. Cross-chat retrieval (Phase 7) and deterministic grounding diagnostics (Phase 8) are designed here but explicitly sequenced after the same-chat/image/budget/generation work is stable, per spec Section 14.

## Technical Context

- **Language**: TypeScript ~6.0 strict mode, React 19.2, React Native 0.85.3 (unchanged from Spec 006).
- **Platform**: Android, Expo SDK 56, New Architecture, NDK 26.3.11579264 (unchanged).
- **Existing runtime**: Qwen3-VL through `llama.rn` 0.12.5. Confirmed via `node_modules/llama.rn/src/index.ts`: the native context already exposes `tokenize(text): Promise<{ tokens: number[] }>`, `detokenize()`, `embedding()`, and `stopCompletion(): Promise<void>` — all usable without adding a dependency.
- **Existing persistence**: SQLite via `src/persistence/sqlite/` (Constitution VIII), upgraded to `SCHEMA_VERSION = 4` through the ordered `Migrations.ts` runner for Phase 7's `excluded_from_cross_chat` column; no destructive reset is used.
- **Existing state to extend, not replace**: `ContextOrchestrator`, `HybridRetriever`, `EmbeddingService`/`EmbeddingBackfill` (embedding-manifest-gated, unchanged gate), `ImageEvidencePolicy` (exists, unused), `AnswerPostProcessor`, `ContextWindow` (existing token-estimate trim), `ResponseMode` config, `DeviceResourcePolicy` (single-flight), MMKV `settingsStore`.
- **New modules**: a request classifier (pure functions, no new dependency), a token-based budget policy (replacing `CharacterContextBudgetPolicy` as the router's measurement), a lexical/semantic fusion step inside `HybridRetriever`, a classification-aware generation-plan resolver that separates soft targets from hard safety limits, and (Phase 7 only) a cross-chat scope resolver plus one new SQL column and one new MMKV setting.
- **Testing**: Jest + React Native Testing Library, tests-first for the five focus areas in spec Section 12 (routing, token-budget protection, image-reference selection, cross-chat isolation, semantic/lexical fallback+fusion), consistent with Constitution VI (TDD for inference-pipeline code).
- **Target scale**: unchanged from Spec 006 (200+ conversations, hundreds of messages per conversation); cross-chat scope (Phase 7) additionally spans that same conversation set on one device.
- **Performance**: tiers 1/2/4 must not measurably regress Spec 006's retrieval/assembly latency budget (<1.5s for the active chat). Tier 3 is a separately diagnosed optional planning operation: at most 96 output tokens and an 8-second execution timeout after its single-flight lease is acquired; queue wait is measured separately. Pixel inspection remains a separately measured inference operation.
- **Offline**: no network use anywhere in this feature, matching Constitution I.
- **Memory**: no new native dependency is introduced; iterative candidate ranking stays synchronous, while final verification uses a bounded format/tokenize/reduce/re-tokenize flow with an explicit pass cap on the inference context the request already needs (see `research.md` §1).

## Approved Architecture Decisions

1. **Historical baseline (superseded for new work):** classification was a pure deterministic layer in front of `ContextOrchestrator`. It remains only as legacy/shadow input after Wave A.
2. **Historical baseline (absolute behavior superseded):** the completed independent-question path short-circuited every source. Wave A adds the bounded FR-086 recovery; authoritative planning later replaces this kill switch with field-level source requirements.
3. **Token-budget measurement is two-tier and bounded**: a calibrated estimator drives synchronous selection; the actual formatted Qwen prompt is then tokenized natively. An over-limit result evicts eligible context and is formatted/tokenized again; if only system plus current input remains, the request is shortened from measured native excess while preserving its beginning, end, visible marker, and media path. A small explicit pass cap guarantees termination, and completion is never called without a final fitting measurement.
4. **Lexical/semantic fusion uses Reciprocal Rank Fusion (RRF) plus an explicit exact-match guarantee**: deterministic token extraction retains first-position and multi-word proper names, numbers, prices, dates, and identifiers while filtering generic sentence-opening question/command words before the per-request limit (spec FR-014/FR-019a).
5. **"Use original image" for a pixel-dependent request means issuing a new vision-inference call through the Qwen multimodal path** via the existing single-flight `InferenceQueue`/`DeviceResourcePolicy`, producing a new evidence row versioned like any other evidence write — never a routing label alone, and never satisfied by selecting an image ID or reusing stored evidence alone (spec FR-008).
6. **Superseded:** an unresolved ambiguous image reference no longer defaults to the active image. It selects no image/evidence and requires clarification. Active-image resolution is valid only when the active visual entity is semantically referenced and no other candidate is materially plausible.
7. **Earlier loop stopping has one native owner**: `QwenLlamaRuntime` alone calls `stopCompletion()` for a confirmed loop and returns a completed `looping` result. Queue-level streaming does not issue a duplicate abort, and user cancellation is idempotent. Deterministic mocks validate ownership/state behavior; physical acceptance remains open under T034.
- **Soft targets are not native ceilings**: classification may shorten the
   desired answer target, but ordinary visible prose and continuations retain the
   full response-mode hard maximum (320/640/1024). Reduced `n_predict` values are
   reserved for structurally bounded output, and runtime diagnostics report the
   exact effective native value.
8. **Cross-chat exclusion is a new SQL column added through the existing ordered `Migrations.ts` runner** (bump `SCHEMA_VERSION` to 4), not a destructive reset — Spec 006's migration mechanism already supports this safely.
9. **Embedding activation remains artifact-gated**, but the current revision does
   not place planner authority behind that gate.
10. **Historical sequencing superseded:** the first architecture ran
     classification before query embedding. Wave D uses deterministic candidate/
     scope construction and the plan; an independent label alone neither forces
     nor forbids semantic scoring.

**Lexical-only topic/entity resolution (clarification):** When embeddings are
unavailable, authoritative planning may match active topics and entities using
conversation-state ledger identities, canonical labels, known aliases, exact
lexical matches, code identifiers, direct references, and active comparison
state. This does not add semantic regex routing.
11. **Cross-chat eligibility is independent of current-chat length**: when opted in, explicit memory-seeking/prior-conversation language can expand scope from a new or short chat; ordinary independent questions never do.
12. **Grounding includes current inference evidence**: diagnostics assess selected context plus the current turn's fresh hidden visual evidence without mutating canonical context or changing the visible answer.

## Constitution Check

| Principle | Status | Plan |
|---|---|---|
| I. Privacy-first (NON-NEGOTIABLE) | Pass | Classification, budgeting, fusion, and (Phase 7) cross-chat retrieval are all pure/local computations over on-device SQL data; no network call is introduced anywhere. |
| II. Single-flight inference queue (NON-NEGOTIABLE) | Pass | Pixel-dependent re-inference (Phase 2) and any future grounding checks reuse the existing `InferenceQueue`/`DeviceResourcePolicy`; classification/budgeting/fusion run in plain JS with no model call. |
| III. Graceful degradation | Pass | Ambiguous image references remain unresolved, uncertain durable-memory writes are not persisted, and retrieval falls back to fully supported lexical-only operation; no path crashes or silently removes an attachment/direct reference. |
| IV. Memory safety on constrained hardware | Pass | No new native dependency; iterative ranking uses arithmetic estimation, while bounded tier-2 reconciliation reuses the request's native context and has an explicit maximum pass count. Pixel-dependent re-inference remains single-flight. |
| V. Minimal, readable TypeScript | Pass | Classification and fusion are small pure functions layered onto existing interfaces (`HybridContextSources`, `ContextBudgetPolicy`); no new abstraction layer beyond what the spec requires. |
| VI. TDD for core systems (NON-NEGOTIABLE) | Pass | Spec Section 12's five focus areas (routing, token-budget, image-reference, cross-chat isolation, fusion/fallback) get failing tests before implementation, per `tasks.md` (to be generated by `/speckit-tasks`). |
| VII. New Architecture only | Pass | No new native dependency is added; `llama.rn`'s existing `tokenize`/`stopCompletion` are already-linked New Architecture-compatible APIs. |
| VIII. Canonical SQL store, settings-only MMKV | Pass | The Phase 7 `excluded_from_cross_chat` column is added via the existing `Migrations.ts` runner (bump to `SCHEMA_VERSION = 4`); the global cross-chat toggle is a small MMKV setting, consistent with existing `defaultResponseMode` precedent. |
| IX. Verify before assuming | Pass | `llama.rn` 0.12.5's `tokenize()`/`stopCompletion()` availability and call shape were confirmed by reading `node_modules/llama.rn/src/index.ts` directly (see Technical Context) rather than assumed; both must be re-verified against whatever version is actually linked before Phase 4/5 implementation, and no sampling/stopping/token-counting constant is pinned before manual device validation (spec FR-036a). |
| X. Hard architecture boundaries | Pass | Classification/budgeting/fusion live in `src/inference/` and `src/retrieval/`; no screen imports inference internals; the cross-chat exclusion flag is read through `ConversationRepository`, not a new cross-boundary import. |
| XI. Design source of truth | Pass | The only new UI is a global cross-chat toggle and a per-conversation exclusion control (Phase 7), built from existing `design/` tokens and shared settings-row components; no new visual language. |

No NON-NEGOTIABLE principle is at risk. No Complexity Tracking entry is required.

## Project Structure

### Documentation (this feature)

```text
specs/007-context-routing-and-answer-quality/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   ├── request-routing.md
│   ├── image-continuity.md
│   ├── token-budget.md
│   ├── retrieval-fusion.md
│   ├── generation-quality.md
│   ├── diagnostics.md
│   └── cross-chat.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by /speckit-plan)
```

### Source Code (repository root)

This is a single Expo/React Native application (Option 1: single project); there is no separate frontend/backend split. All changes extend existing files/directories from Spec 006 — no new top-level directory is introduced.

```text
src/
├── inference/
│   ├── RequestClassifier.ts        # NEW — pure classification (Section 4)
│   ├── ContextOrchestrator.ts      # extended — classification-gated source selection (Sections 4, 8)
│   ├── ContextWindow.ts            # extended — reconciled with the router's token budget (Section 8)
│   ├── ImageEvidencePolicy.ts      # extended — wired into orchestrator, pixel-dependent re-inference trigger (Section 5)
│   ├── GenerationTuning.ts         # extended — classification-aware output-length resolution (Section 9)
│   ├── AnswerPostProcessor.ts      # extended — earlier in-stream loop detection hook (Section 9)
│   └── DeviceResourcePolicy.ts     # unchanged — reused for pixel-dependent re-inference
├── retrieval/
│   ├── HybridRetriever.ts          # extended — RRF fusion instead of semantic-overrides-lexical (Section 6)
│   └── EmbeddingService.ts         # unchanged — still gated by embedding-manifest approval
├── persistence/
│   ├── sqlite/Migrations.ts        # extended — Phase 7 migration adding excluded_from_cross_chat
│   └── ConversationRepository.ts   # extended — Phase 7 exclusion flag read/write
├── store/
│   ├── conversationStore.ts        # extended — wires classifier + token budget policy into runtime orchestrator
│   └── settingsStore.ts            # extended — Phase 7 global cross-chat setting
├── diagnostics/
│   └── DiagnosticsBundleBuilder.ts # extended — classification, retrieval-mode, image-decision fields (Section 10)
└── components/
    └── settings/CrossChatSettingRow.tsx  # NEW, Phase 7 only — existing design tokens/components
```

**Structure Decision**: Single Expo/React Native app; this feature is implemented entirely as extensions to existing `src/inference/`, `src/retrieval/`, `src/persistence/`, `src/store/`, and `src/diagnostics/` modules, plus one new pure-function file (`RequestClassifier.ts`) and one new Phase-7 settings-row component. No new project, package, or top-level directory.

## Pinned Reconciliation Constants

These values are fixed here and in `data-model.md`/`research.md`, pinned by tests, and changeable only through recorded evaluation — superseding the character-based constants pinned in Spec 006 where noted:

- **Cosine similarity threshold**: `0.62` (unchanged from Spec 006, `COSINE_SIMILARITY_THRESHOLD`).
- **Fusion method**: Reciprocal Rank Fusion, `score = Σ 1 / (k + rank)` with `k = 60` (a widely used default that avoids over-weighting the top rank of either list), deduplicated by source message, deterministic tie-break by `(score desc, createdAt desc, stableId asc)` matching existing `compareRetrievedItems` conventions, plus the exact-match guarantee (spec FR-019a) applied before the retrieval limit is enforced.
- **Context budget unit**: MOVES from `CharacterContextBudgetPolicy` (raw characters) to a two-tier token measurement (research.md §1): a calibrated estimate for iterative selection, reconciled by a single real `tokenize()` call on the final assembled prompt. The three response-mode budgets (previously 4,000/7,000/11,000 characters) are re-expressed in tokens as the selected-context-pool bucket only (one of five reserved buckets, spec FR-026a), using the calibration ratio as a starting point, then recalibrated (Open Question in spec Section 13).
- **RRF constant `k`**: `60`, a standard default; revisit only via recorded evaluation, same governance as the cosine threshold.
- **Schema version**: Phase 7 bumps `SCHEMA_VERSION` from `3` to `4` for the `excluded_from_cross_chat` column.

## Historical Implementation Phases 0–9 (completed baseline; superseded for new work)

Phase order matches spec Section 14 exactly and will map 1:1 onto `tasks.md` phases once `/speckit-tasks` runs.

### Phase 0 — Setup

- Record baseline fixtures for independent-question, follow-up, image, long-conversation, and repetition/verbosity scenarios in the existing `src/evaluation` harness, so Phases 1–6 have a before/after comparison (spec MV-001–MV-010).
- Confirm current `llama.rn` `tokenize()`/`stopCompletion()` availability and calling shape against the actually-linked `llama.rn` version (already done for this plan; re-verify if the dependency version changes before implementation begins — Constitution IX).

### Phase 1 — Diagnostics-only routing visibility

- Add `RequestClassifier` (pure functions) and wire it into `ContextOrchestrator` in observation-only mode: diagnostics record the classification and which sources *would* be considered/selected, without changing what is actually assembled yet.
- Extend `ContextSelectionDiagnostics`/`DiagnosticsBundleBuilder` with the classification, would-be retrieval-mode, would-be image-decision, and ambiguous-reference fields (spec FR-037).
- No behavior change to answers in this phase — it exists purely to compare "today's fixed assembly" against "what the router would have chosen," across the Phase 0 baseline fixtures.

### Phase 2 — Image identity, reference resolution, and original-pixel follow-ups

- Wire `ImageEvidencePolicy.evaluateImageEvidenceAvailability` into `ContextOrchestrator` for every image-related classification.
- Historical implementation used regex-led pixel signals and a direct Qwen
  reinspection path. Wave B replaces semantic ownership with `TurnPlan`.
- Historical implementation mapped tied/weak/missing image matches to the active
  image. That behavior is superseded: Wave B leaves them unresolved and requests
  clarification with no selected image/evidence.
- Preserve existing older-image resolution and missing-original handling (spec FR-010–FR-012); extend, don't replace.

### Phase 3 — Minimal-context request routing

- Historical implementation switched to a current-request-only independent hard
  skip. Wave A adds bounded exact/direct recovery; Wave E replaces the classifier
  gate with field-level plan requirements.
- Diagnostics added in Phase 1 now reflect actual (not merely observed) selection.

### Phase 4 — Model-aware token budgeting

- Replace `CharacterContextBudgetPolicy` with the two-tier token measurement from
  `research.md` §1: calibrated iterative selection followed by bounded native
  format/tokenize/reduce/re-tokenize verification against the hard Qwen input
  limit (spec FR-026/FR-026b/FR-027).
- Introduce the five reserved capacity buckets (system instructions, current input, image input, selected-context pool, generated output) so the selected-context pool cannot crowd out the other four (spec FR-026a).
- Recalibrate the three response-mode budgets from characters to the selected-context-pool token bucket (starting ratio per `research.md`; final numbers per spec Open Questions/evaluation harness).
- Preserve protected-source and eviction-order behavior (current request and active/referenced image evidence never evicted; eviction order cross-chat → same-chat retrieved → facts → summary → recent-turn floor, only where one exists) in token terms (spec FR-028/FR-030).

### Phase 5 — Generation length, repetition, and stopping improvements

- Add classification-aware output-length resolution layered on top of the existing per-mode `answerTargetTokens`/`generationLimit` — shortening only when the task is genuinely short, never shortening a request that needs more (spec FR-032/FR-034).
- Re-verify `stopCompletion()`'s current behavior against the actually-linked `llama.rn` version and manually validate on a physical device (spec FR-036a, Constitution IX) before pinning any detection threshold; add streaming-time repetition detection that calls `stopCompletion()` when a loop is confirmed mid-generation, before the hard `n_predict` limit is reached, while preserving already-generated partial text exactly as Spec 006's checkpoint/recovery already guarantees (spec FR-033).
- Improve (not merely preserve) `AnswerPostProcessor`'s post-hoc cleanup where the earlier-stopping change surfaces new truncation shapes to handle (spec FR-031).

### Phase 6 — Same-chat semantic embedding activation and hybrid fusion

- Add query-time embedding generation so `HybridRetriever` receives a real `queryVector` when the embedding runtime is active (spec FR-015).
- Implement RRF-based fusion of lexical and semantic candidate lists, replacing the current "semantic overrides lexical" behavior, with source-message dedup, deterministic tie-break, and the exact-match guarantee for names/numbers/prices/dates/identifiers (spec FR-013/FR-014/FR-019a).
- **⛔ Gated (embedding manifest)**: this phase ships inert behind the existing lexical-fallback path until the pre-existing embedding-artifact approval (model identity, license, hash, dimensions, latency, memory, device compatibility) lands, exactly as `EmbeddingService`/`EmbeddingBackfill` do today (spec FR-016). No part of this phase asserts that approval has already happened.

### Phase 7 — Optional scoped cross-chat retrieval

- Add the `excluded_from_cross_chat` column via a new `Migrations.ts` entry (`SCHEMA_VERSION` 3 → 4) and a global MMKV cross-chat setting in `settingsStore` (spec FR-020/FR-021).
- Extend `HybridRetriever`'s scope resolution to include opted-in, non-excluded local conversations when the global setting is on, applying the same scope-before-scoring, relevance, dedup, fusion, and untrusted-attribution rules as same-chat retrieval (spec FR-018/FR-022).
- Add the settings-row UI (global toggle) and a per-conversation exclusion control, built from existing design tokens/components (spec Non-Goals: no new picker UX).
- Built only once Phases 1–6 are validated stable per spec Section 7's explicit sequencing (routing, image continuity, token budgeting, generation improvements, and same-chat semantic retrieval).

### Phase 8 — Optional grounding diagnostics

- Add the deterministic claim-vs-evidence heuristic (spec FR-036) as a diagnostics-only field, with no visible answer change and no second model-generation pass; it never rewrites or suppresses the answer.
- Built only once Phases 1–7 are validated stable; its own focused tests are scoped at that time and are not part of this feature's core required tests (spec Section 12).

### Phase 9 — Final manual device validation

- Run `npm run type-check`, `npm run lint`, and `npm test -- --runInBand`; focused suites may supplement but never replace the complete Jest suite. Then run the full manual validation matrix (spec Section 11, MV-001–MV-018) on a physical device against the Phase 0 baseline fixtures, including final airplane-mode operation (MV-017).
- Confirm zero regression against Spec 006 acceptance scenarios and success criteria (spec Non-Goals, MV-018).

## Architecture Revision Decisions (authoritative)

1. **One validated `TurnPlan` is the sole semantic authority.** It contains
   the Wave A MVP fields defined in `unified-turn-planning.md`. Topic/entity and
   fine-grained ranking enrichment may arrive later without introducing another
   plan. Downstream modules execute it and report capability/asset outcomes
   without reclassification.
2. **Planning is tiered, not regex-primary.** Deterministic application state is
   evaluated first; semantic topic/entity/retrieval signals second; constrained
   structured-model fallback only for ambiguity; deterministic validation last.
   Regex remains valid for syntax and structured-output validation.
3. **A field-level safe fallback replaces the global independent-question kill
   switch.** Irrelevant material is still excluded, but uncertainty in one field
   cannot erase an attached image, explicit reference, explicit memory write, or
   independently relevant retrieval source.
   Before authority transfer, a bounded exact/direct recovery protects those
   sources from the completed legacy hard skip.
4. **A derived conversation-state ledger supports natural dependencies.** It
   tracks topics, entities, comparisons, images, artifacts, unresolved
   references, decisions, and explicit memories while canonical messages remain
   authoritative in SQLite.
5. **Memory is layered and provenance bearing.** Explicit user memories are
   immediately readable; episodic units, summaries, facts, image evidence, and
   optional cross-chat memory retain source IDs/revisions and ordinal
   reliability. General message editing is not introduced; revisions cover
   lifecycle/status/version invalidation.
6. **Typed retrieval units replace message-only retrieval assumptions.** User
   messages, completed answers, code blocks, memories, facts, decisions,
   summaries, and image evidence share stable provenance/revision metadata.
7. **EmbeddingGemma is the first provider, not an application dependency.** An
   `EmbeddingProvider` boundary owns descriptors, query/document policies,
   readiness, cancellation, normalization, source revisions, and versioned
   index migration. The production dimension is selected only after benchmarking
   at least 256 and 512. Planner authority does not depend on approval or index
   readiness; lexical-only is a supported authoritative runtime mode.
8. **Hybrid retrieval is multi-signal and always preserves lexical exactness.**
   Semantic, lexical, entity, provenance, reliability, scope, and recency signals
   rank eligible units. Semantic retrieval is not gated solely by an
   “independent” boolean.
9. **The main inference runtime is provider independent.** Current Qwen3-VL
   remains unchanged, but planning and storage depend only on a capability
   descriptor for generation, images, extraction, context/tokenizer limits,
   projector, prompt format, compatibility, and cancellation.
10. **Vision execution is planned once.** Strategies are no vision, reuse
    evidence, inspect original, inspect plus structured extraction, or compare
    multiple evidence sets. Image pixels, structured evidence, and assistant
    prose are separate sources; refusals never become image authority. The MVP
    evidence shape is summary/objects/text/numeric values/optional associations/
    uncertainty/status; spatial scene graphs are deferred.
11. **Context assembly is provider-aware and provenance preserving.** It protects
    current input and required images/references, ranks and deduplicates eligible
    sources, preserves generation headroom, and verifies the final prompt using
    the active provider's native tokenizer.
12. **Authority moves only after shadow evidence.** Legacy and proposed plans are
    compared through diagnostics and golden fixtures until controlled activation.
    Shadow never changes execution; controlled mode gives named classes wholly to
    the new planner; authoritative mode bypasses legacy semantics. No turn mixes
    authorities, and semantic regex authority is removed only after proof.
13. **Tier 3 fills only unresolved fields.** Its deterministic invocation gate,
    constrained candidate IDs, bounded schema/rationale codes, `0.80` acceptance
    threshold, 96-token/8-second budgets, cancellation/suspension handling, and
    conservative fallback are fixed by contract. Golden scenarios never invoke
    it.
14. **Ledger publication is synchronous with turn completion.** Canonical turn
    persistence precedes validated derivation; the ledger is updated/rebuilt and
    published before the next turn can plan. Versioned caches rebuild safely on
    cold start.

## Revised Contract Map

```text
contracts/
├── unified-turn-planning.md       # new authoritative TurnPlan
├── conversation-state-ledger.md   # new derived state and memory layers
├── embedding-provider.md          # new provider and index lifecycle
├── main-inference-provider.md     # new main-model capability boundary
├── request-routing.md             # extended as legacy/shadow adapter
├── image-continuity.md            # extended into authoritative vision execution
├── retrieval-fusion.md            # extended for typed units and multi-signal ranking
├── token-budget.md                # extended for provider-native verification
├── generation-quality.md          # consumes TurnPlan requirements
├── diagnostics.md                 # shadow/authoritative plan diagnostics
└── cross-chat.md                  # optional scope over eligible memory units
```

## Revised Architecture Boundaries

- **Planning boundary**: constructs and validates `TurnPlan`; it reads
  deterministic state, ledger state, and semantic signals through interfaces.
- **Ledger/memory boundary**: derives queryable state from canonical repository
  events and performs immediate explicit memory writes; it does not generate.
- **Retrieval boundary**: indexes and ranks typed eligible units; it does not
  decide final context or reliability.
- **Embedding boundary**: provider-specific artifact/runtime/index concerns; it
  does not inspect pixels or answer.
- **Vision boundary**: executes the plan against first-class image entities and
  persists structured evidence; it does not reinterpret user intent.
- **Main inference boundary**: exposes capabilities, native tokenization,
  structured extraction, generation, and cancellation; it does not own planning
  or storage schemas.
- **Context assembly boundary**: protects required sources, ranks/deduplicates
  candidates, budgets, preserves provenance, and verifies the final prompt.
- **Queue boundary**: enforces single flight and executes planned operations; it
  never selects a different modality or image strategy.

## Revised Rollout Waves

The legacy Phases 0–9 above remain historical. Remaining Spec 007 work ships in
five independently gated waves; exact tasks are in `tasks.md`.

### Wave A — Single authority foundation

- **Entry**: corrected typed contracts and a captured legacy diagnostic baseline.
- **Deliver**: `TurnPlan` MVP, validator, Tier-3 unresolved-field contract,
  `shadow | controlled | authoritative` semantics, sanitized diagnostics, golden
  deterministic fixtures, and the temporary independent-routing recovery.
- **Feature gates**: shadow diagnostics and recovery are independently disabled
  by default; controlled classes use an explicit allowlist.
- **Exit**: every fixture validates, protected exact/direct sources survive a
  false independent label, all goldens prove Tier 3 was not invoked, and mocked
  Tier-3 failures take deterministic fallback.
- **Rollback**: disable gates and execute the complete legacy turn.
- **Tests/device**: focused plan/validator/mode/recovery/Tier-3 contract tests;
  physical cancellation, app-suspension, timeout, lease-release, and next-turn
  readiness before controlled Tier-3 use.

### Wave B — Vision continuity

- **Entry**: Wave A validator plus a named image-class controlled gate.
- **Deliver**: for each explicitly enabled image scenario class, the validated
  `TurnPlan` controls the complete turn: reference resolution, image selection,
  context-source selection, context assembly, vision strategy,
  generation-task projection, and inference execution. Legacy semantic routing
  is bypassed for that entire turn. Also deliver first-class image entities, MVP
  structured evidence/status, persistence, active-image follow-ups,
  reinspection, comparison, and refusal-contamination prevention.
- **Feature gate**: only the named image turn classes move as complete turns.
- **Exit**: image goldens and extraction/missing-asset failures pass with separate
  IDs/provenance and no unresolved reference selecting an image; a controlled
  image-turn test proves zero legacy semantic decisions. This does not migrate
  global context assembly for non-enabled classes; that remains Wave E.
- **Rollback**: disable the image class and execute the complete legacy turn.
- **Tests/device**: focused reference, strategy, status, persistence, refusal, and
  multi-image tests; physical pixel reinspection/comparison/persistence checks.

### Wave C — Ledger and explicit memory

- **Entry**: Wave A plan/provenance contracts and canonical turn-completion hooks.
- **Deliver**: versioned ledger/cache rebuild, next-turn publication ordering,
  active topics/entities/comparisons/images/code, immediate explicit memories,
  conservative read/write detection, correction/supersession, ordinal
  reliability, and lifecycle invalidation.
- **Feature gates**: ledger reads and durable writes are separate.
- **Exit**: the next turn sees the last completed turn, cold start rebuilds, false
  writes remain absent, and exact recall works without compaction/embeddings.
- **Rollback**: disable derived reads/writes; canonical data remains intact and
  supports later rebuild.
- **Tests/device**: focused transition, restart, corruption, correction,
  provenance/reliability, deletion/retry/regeneration tests; physical immediate
  recall and restart validation.

### Wave D — EmbeddingGemma and semantic retrieval

- **Entry**: typed retrieval units and the provider/index contract. Wave E does
  not depend on this entry or exit.
- **Deliver**: artifact/runtime approval, 256/512 benchmark, provider adapter,
  restart-safe indexing, shadow ranking, controlled same-chat activation,
  separately gated cross-chat semantics, and version migration.
- **Feature gates**: provider readiness, same-chat semantics, and cross-chat
  semantics are independent.
- **Exit**: quality/device gates pass and lexical fallback succeeds through
  building, pause, failure, staleness, process death, and migration.
- **Rollback**: deactivate the new index/provider atomically and continue
  lexical-only; retire the prior index later.
- **Tests/device**: focused descriptor, vector compatibility, backfill,
  cancellation, atomic activation, deletion, scope, and fallback tests; physical
  quality/memory/latency/battery/pause/restart/offline validation.

### Wave E — Authority transfer and cleanup

- **Entry**: Waves A–C exit and authority-transfer evidence. Wave D may be
  unavailable, building, active, or complete.
- **Deliver**: global authoritative ownership, complete legacy semantic bypass,
  obsolete semantic-regex removal, final diagnostics/physical validation, then
  rollback-gate removal.
- **Feature gates**: global authority first; rollback removal only after final
  physical acceptance.
- **Exit**: all supported turns have exactly one new `planOwner`; goldens and
  regressions pass in lexical-only mode and, if approved, semantic mode.
- **Rollback**: until final acceptance, return the whole turn to legacy. Mixed
  legacy/new execution is prohibited.
- **Tests/device**: focused owner/bypass/provider-substitution/lexical-only tests;
  complete airplane-mode, missing-asset, cancellation, restart, device-resource,
  Spec 006/007, and representative 6–8GB physical matrix.

Dependency graph: `A → B → E` and `A → C → E`; `A → D` is independent of
`B/C → E`. Wave D may activate before or after authority transfer. No task may
simultaneously change planning, vision, memory, retrieval, generation, queue,
and grounding.

## Revised Constitution Check

| Principle | Status | Revision impact |
|---|---|---|
| I. Privacy-first | Pass | Planning, embeddings, retrieval, provider execution, and persistence remain local and airplane-mode testable. |
| II. Single-flight | Pass | Model, vision, planner-fallback model calls, indexing, and compaction share the device resource policy; the queue executes rather than replans. |
| III. Graceful degradation | Pass | Field-level fallback, lexical fallback, unresolved-reference handling, provider readiness, and missing-asset states are explicit. |
| IV. Memory safety | Gate | EmbeddingGemma dimensions/runtime and structured vision extraction require 6–8GB benchmarks before activation. |
| V. Minimal TypeScript | Pass | Contracts separate provider-specific complexity while retaining one plan and one canonical store. |
| VI. TDD core systems | Pass | Every new inference/planning/model-lifecycle function receives failing tests before implementation; golden contracts are added before authority transfer. |
| VII. New Architecture | Gate | EmbeddingGemma runtime and any native integration require current New Architecture/NDK verification before installation or activation. |
| VIII. Canonical SQL | Pass | Messages remain canonical; ledger, units, summaries, evidence, and vectors are derived SQL data with cascade invalidation. MMKV remains feature/settings only. |
| IX. Verify before assuming | Gate | Main and embedding provider APIs, tokenizer behavior, dimensions, artifacts, prompt policies, and cancellation are benchmark/approval tasks. |
| X. Hard boundaries | Pass | Planning, memory, retrieval, vision, providers, queue, and context assembly have explicit responsibilities and no UI imports. |
| XI. Design source | Pass | This revision adds no production UI design; future settings/clarification surfaces must follow `design/`. |

## Resolved Contradictions in the Legacy Plan

- The legacy plan says classification is a pure deterministic regex-led layer,
  while device failures require semantic state and constrained model fallback.
  `TurnPlan` supersedes that authority.
- The legacy plan says an independent classification short-circuits every source,
  while the revision requires one error not to disable memory, retrieval, facts,
  summaries, and image continuity simultaneously. Field-level requirements now
  control sources.
- The legacy plan calls active-image fallback “not a guess” for ambiguous image
  references. The revised safety rule treats it as an unjustified semantic choice
  and leaves the reference unresolved.
- The legacy plan says no embedding model is selected. This revision selects
  EmbeddingGemma as the first provider to evaluate but keeps artifact activation
  and dimensions gated.
- The legacy plan makes Qwen-specific tokenizer/context assumptions part of
  application budgeting. The revision moves them behind the main provider
  capability descriptor.
- The legacy plan allows the queue/runtime and generation planner to own semantic
  decisions separately. They now execute the validated plan.
- The prior sequential rollout placed EmbeddingGemma before planner authority.
  Wave E now depends on Waves A–C, not Wave D; lexical-only authority is required
  acceptance coverage.
- The constrained planner was previously open-ended. Its partial-output schema,
  deterministic gate/post-processing, budgets, confidence threshold, resource
  policy, cancellation/suspension behavior, and fallback are now binding.
- `sourceRevision` previously implied possible general message edits. Spec 007
  now limits invalidation to creation/deletion/conversation deletion, attempts,
  supersession, evidence reinference, version changes, and rebuilds.
- The later duplicate historical `T056` is corrected to `T111` without changing
  either completed state; remaining work retains T059–T110 and continues after
  T111.

## Complexity Tracking

No Constitution Check violations require justification; this table is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
