# Implementation Plan: Context Routing and Answer Quality

**Branch**: `007-context-routing-and-answer-quality` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-context-routing-and-answer-quality/spec.md`

## Summary

Extend Spec 006's `ContextOrchestrator` with a deterministic request-classification step (8 combinable categories) so independent, self-contained questions receive zero unrelated context, wire the already-built-but-inert pieces (`ImageEvidencePolicy`, query-time embeddings, `HybridRetriever` fusion) into the live path, replace the router's character-based budget with a token-aware one reconciled against the existing hard `ContextWindow` trim, and improve generation quality (task-sensitive length targets, earlier in-stream loop stopping) — all as incremental changes to existing modules. Cross-chat retrieval (Phase 7) and deterministic grounding diagnostics (Phase 8) are designed here but explicitly sequenced after the same-chat/image/budget/generation work is stable, per spec Section 14.

## Technical Context

- **Language**: TypeScript ~6.0 strict mode, React 19.2, React Native 0.85.3 (unchanged from Spec 006).
- **Platform**: Android, Expo SDK 56, New Architecture, NDK 26.3.11579264 (unchanged).
- **Existing runtime**: Qwen3-VL through `llama.rn` 0.12.5. Confirmed via `node_modules/llama.rn/src/index.ts`: the native context already exposes `tokenize(text): Promise<{ tokens: number[] }>`, `detokenize()`, `embedding()`, and `stopCompletion(): Promise<void>` — all usable without adding a dependency.
- **Existing persistence**: SQLite via `src/persistence/sqlite/` (Constitution VIII), current `SCHEMA_VERSION = 3` with an ordered `Migrations.ts` runner already in place — a new migration is the correct mechanism for the Phase 7 `excluded_from_cross_chat` column, not a destructive reset.
- **Existing state to extend, not replace**: `ContextOrchestrator`, `HybridRetriever`, `EmbeddingService`/`EmbeddingBackfill` (embedding-manifest-gated, unchanged gate), `ImageEvidencePolicy` (exists, unused), `AnswerPostProcessor`, `ContextWindow` (existing token-estimate trim), `ResponseMode` config, `DeviceResourcePolicy` (single-flight), MMKV `settingsStore`.
- **New modules**: a request classifier (pure functions, no new dependency), a token-based budget policy (replacing `CharacterContextBudgetPolicy` as the router's measurement), a lexical/semantic fusion step inside `HybridRetriever`, a classification-aware generation-limit resolver, and (Phase 7 only) a cross-chat scope resolver plus one new SQL column and one new MMKV setting.
- **Testing**: Jest + React Native Testing Library, tests-first for the five focus areas in spec Section 12 (routing, token-budget protection, image-reference selection, cross-chat isolation, semantic/lexical fallback+fusion), consistent with Constitution VI (TDD for inference-pipeline code).
- **Target scale**: unchanged from Spec 006 (200+ conversations, hundreds of messages per conversation); cross-chat scope (Phase 7) additionally spans that same conversation set on one device.
- **Performance**: routing/classification adds no additional model inference and must not measurably regress Spec 006's retrieval/assembly latency budget (<1.5s for the active chat); pixel-dependent re-inference (Phase 2) costs one additional vision-inference call, gated by the existing single-flight queue like any other inference.
- **Offline**: no network use anywhere in this feature, matching Constitution I.
- **Memory**: no new native dependency is introduced; the router's iterative candidate ranking avoids extra native `tokenize()` round-trips, reserving the one real per-request `tokenize()` call for a final-prompt verification that reuses an inference context acquisition the request needed anyway (see `research.md` §1).

## Approved Architecture Decisions

1. **Classification is a pure, deterministic function layer in front of `ContextOrchestrator`**, not a new orchestrator or a rewrite; it consumes the same `CanonicalConversationSnapshot` already passed in today.
2. **The independent-question zero-context rule is enforced by classification gating, not by making every source "optional"** — an independent text question short-circuits source resolution entirely rather than resolving every source and then discarding results. Consequently, the recent-turn floor itself does not apply to a pure independent-question request — there is nothing to protect, not an empty protected floor (spec FR-004/FR-030, Superseded Requirements).
3. **Token-budget measurement is two-tier**: a calibrated character-to-token estimate (consistent with `ContextWindow.estimateMessageTokens`) drives the router's iterative candidate ranking/eviction, while a single real `llama.rn` `tokenize()` call on the final assembled prompt — reusing the context acquisition the request needs anyway for its completion — verifies the result before generation starts (see `research.md` §1 for the full tradeoff and why a live per-candidate `tokenize()` call is rejected but a single final-prompt call is adopted). The budget itself is split into five reserved capacity buckets (system instructions, current input, image input, selected-context pool, generated output) rather than one lump pool (spec FR-026a).
4. **Lexical/semantic fusion uses Reciprocal Rank Fusion (RRF) plus an explicit exact-match guarantee**: RRF combines the two candidate rankings without needing to normalize cosine similarity and lexical-overlap counts onto one scale, and a small additional rule guarantees that a verbatim match on a name, number, price, date, or identifier is never dropped purely because its RRF rank was outscored by weaker semantic matches (spec FR-014/FR-019a).
5. **"Use original image" for a pixel-dependent request means issuing a new vision-inference call through the Qwen multimodal path** via the existing single-flight `InferenceQueue`/`DeviceResourcePolicy`, producing a new evidence row versioned like any other evidence write — never a routing label alone, and never satisfied by selecting an image ID or reusing stored evidence alone (spec FR-008).
6. **An ambiguous image reference (three or more candidate images, no disambiguating detail) defaults to the current active image (same-image-follow-up rules), never a guessed older image** — reusing an existing, well-defined default rather than inventing new UI or silently substituting a specific older image (spec FR-012a, `research.md` §8).
7. **Earlier loop-stopping reuses the existing `stopCompletion()` native call**, the same one already wired for user-initiated cancellation, triggered by a streaming-time repetition check instead of a user tap; the exact detection threshold is chosen only after verifying `stopCompletion()`'s current behavior on a physical device (spec FR-036a, Constitution IX) — no sampling/stopping constant is assumed from a prior version.
8. **Cross-chat exclusion is a new SQL column added through the existing ordered `Migrations.ts` runner** (bump `SCHEMA_VERSION` to 4), not a destructive reset — Spec 006's migration mechanism already supports this safely.
9. **Semantic retrieval activation remains behind the pre-existing embedding-artifact approval gate**; this feature ships the fusion/classification/query-embedding wiring inert-but-ready, exactly as `EmbeddingService`/`EmbeddingBackfill` already ship today. No artifact in this feature asserts or assumes that approval has happened.
10. **The grounding/hallucination assessment (Phase 8) and cross-chat retrieval (Phase 7) are designed in this plan but explicitly not part of the Phase 1–6 delivery slice**, matching spec Section 14; nothing in Phases 1–6 imports or depends on Phase 7/8 code, and grounding never rewrites or suppresses an answer if built.

## Constitution Check

| Principle | Status | Plan |
|---|---|---|
| I. Privacy-first (NON-NEGOTIABLE) | Pass | Classification, budgeting, fusion, and (Phase 7) cross-chat retrieval are all pure/local computations over on-device SQL data; no network call is introduced anywhere. |
| II. Single-flight inference queue (NON-NEGOTIABLE) | Pass | Pixel-dependent re-inference (Phase 2) and any future grounding checks reuse the existing `InferenceQueue`/`DeviceResourcePolicy`; classification/budgeting/fusion run in plain JS with no model call. |
| III. Graceful degradation | Pass | Classification defaults conservatively (ambiguous → follow-up, not independent; ambiguous image reference → current active image, not a guessed older one); retrieval fallback (fused → lexical-only → none, including on embedding-call failure) and missing-image handling are unchanged/extended, never a crash path. |
| IV. Memory safety on constrained hardware | Pass | No new native dependency; the router's iterative candidate ranking uses arithmetic estimation, not a native call, in the hot path — the one real `tokenize()` call per request (tier 2, research.md §1) reuses a context acquisition the request needs anyway. Pixel-dependent re-inference is a normal, single-flight-gated vision inference identical in cost to today's first-image-question path. |
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

## Implementation Phases

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
- Implement pixel-dependent detection (extends the existing `VISUAL_REFERENCE_PATTERN`-style regex approach) and the actual re-inference trigger: a pixel-dependent request with an available original asset issues a new vision-inference call through the Qwen path via the existing single-flight queue, producing a new versioned evidence row (spec FR-008/FR-009).
- Implement the ambiguous-image-reference default (three or more candidate images, no disambiguating detail → current active image, never a guessed older one) and record it in diagnostics (spec FR-012a, `research.md` §8).
- Preserve existing older-image resolution and missing-original handling (spec FR-010–FR-012); extend, don't replace.

### Phase 3 — Minimal-context request routing

- Switch `ContextOrchestrator` from "always assemble" to classification-gated selection: independent text questions short-circuit to current-request-only (no recent-turn floor to protect, since none is owed); follow-ups, image classifications, and long-context-retrieval requests resolve only the sources their classification requires (spec FR-001–FR-006).
- Diagnostics added in Phase 1 now reflect actual (not merely observed) selection.

### Phase 4 — Model-aware token budgeting

- Replace `CharacterContextBudgetPolicy` with the two-tier token measurement from `research.md` §1: a calibrated estimate for iterative selection, verified by one real `tokenize()` call on the final assembled prompt, reconciled against `ContextWindow`'s existing hard trim so the router never selects a set the downstream trim would still cut (spec FR-026/FR-026b/FR-027).
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

- Run type-check, lint, and the five focus-area test suites (Section 12); run the full manual validation matrix (spec Section 11, MV-001–MV-018) on a physical device against the Phase 0 baseline fixtures, including final airplane-mode operation (MV-017).
- Confirm zero regression against Spec 006 acceptance scenarios and success criteria (spec Non-Goals, MV-018).

## Complexity Tracking

No Constitution Check violations require justification; this table is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
