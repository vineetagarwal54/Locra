---
description: "Task list for Context Routing and Answer Quality"
---

# Tasks: Context Routing and Answer Quality

**Input**: Design documents from `specs/007-context-routing-and-answer-quality/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED but intentionally focused, per spec Section 12: only the five named high-risk areas (request routing, token-budget protection, image-reference selection, cross-chat isolation, semantic/lexical fallback+fusion) get failing-test-first coverage (Constitution VI). No tests are added for exact answer wording, end-to-end generation quality, UI snapshots, voice-transcription accuracy, or precise loop-stop timing — those are manual/evaluation-harness validation only (spec Section 11, `quickstart.md`).

**Organization**: Grouped by the 10 user stories from spec.md; phase order matches `plan.md`'s Implementation Phases exactly (spec Section 14's sequencing is explicit and non-negotiable — image continuity ships before minimal-context routing, budgeting before generation improvements, cross-chat and grounding are deliberately last).

**Gates**: Phase 7 (same-chat semantic/hybrid retrieval) is **⛔ GATED** behind the pre-existing embedding-artifact approval (manifest hash, license, device-compatibility verification) established in Spec 006 — the same gate that already blocks `EmbeddingService`/`EmbeddingBackfill` today. Gated tasks ship code that remains inert (lexical-fallback only) until that approval lands.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US10 (setup/foundational/polish carry no story label)

## Path Conventions

Single Expo/React Native app. Source under `src/`; focused unit tests under `tests/unit/`, cross-module flow tests under `tests/integration/` (matches Spec 006 conventions).

---

## Phase 1: Setup

**Purpose**: Baseline fixtures and dependency re-verification before any implementation.

- [ ] T001 [P] Record baseline evaluation fixtures for independent-question, follow-up, image (new/same/older/pixel-dependent), long-conversation, and repetition/verbosity scenarios in `src/evaluation/baselines/`, for later before/after comparison (spec MV-001–MV-010; plan Phase 0).
- [ ] T002 [P] Re-verify `llama.rn`'s `tokenize()`, `detokenize()`, and `stopCompletion()` call shapes against the currently linked `llama.rn` version (`node_modules/llama.rn/src/index.ts`) and record confirmation in `research.md` (Constitution IX; plan Phase 0).
- [ ] T003 [P] Run `npm run type-check`, `npm run lint`, and `npm test` on the unchanged branch and record the baseline result before implementation.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the classification engine and extend diagnostics types in **observation-only** mode — computed and recorded, but not yet changing any answer's context — so every user-story phase below can build on a stable `RequestClassifier` and diagnostics shape (spec Section 14, Phase 1: "Routing diagnostics... before changing any routing behavior").

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 [P] Add the `RequestClassification` type and extend `ContextSelectionDiagnostics`/`RankedCandidateDiagnostic` in `src/inference/ContextOrchestrator.ts` (and `src/types/models.ts` if needed) per `data-model.md`, without changing existing selection behavior yet.
- [ ] T005 [P] Write failing tests for `RequestClassifier` in `tests/unit/inference/RequestClassifier.test.ts`: all 8 classification flags, `isIndependentTextQuestion`/`isTextFollowUp` mutual exclusivity, combinability of image/pixel/long-context/cross-chat-eligible flags, and the conservative ambiguous-short-reply-defaults-to-follow-up rule (contracts/request-routing.md).
- [ ] T006 Implement `src/inference/RequestClassifier.ts` (`classifyRequest`) to make T005 pass. (depends on T005)
- [ ] T007 Wire `classifyRequest` into `ContextOrchestrator.orchestrate()` in **observation-only** mode: compute and record the classification plus would-be `retrievalMode`/`imageDecision` in diagnostics without changing actual source selection (depends on T004, T006).
- [ ] T008 [P] Extend `src/diagnostics/DiagnosticsBundleBuilder.ts` and `src/diagnostics/DiagnosticsTraceStore.ts` to export the new classification/retrievalMode/imageDecision/crossChatActive/groundingVerdict(`null`) fields per `contracts/diagnostics.md`.

**Checkpoint**: Classification and diagnostics are observable end-to-end; no answer behavior has changed yet.

---

## Phase 3: User Stories 4, 5, 6, 7 — Image Continuity and Original-Pixel Reuse (Priority: P1/P1/P2/P1)

**Goal**: New image questions get evidenced; same-image follow-ups reuse evidence without reprocessing; older-image references resolve to the correct image without silent substitution; pixel-dependent requests re-run the original image through vision inference.

**Independent Test**: Attach an image and ask about it (evidenced); ask a non-visual follow-up (no re-attach); attach a second image and reference the first (correct resolution); ask a pixel-dependent follow-up (fresh re-inference, visible as a new evidence timestamp).

### Tests for Image Continuity ⚠️ (write first, must fail)

- [ ] T009 [P] [US7] Write failing tests extending `tests/unit/inference/ImageEvidencePolicy.test.ts`: pixel-dependent + asset available → `use-original`; pixel-dependent + asset missing → `original-unavailable`; non-pixel-dependent + evidence available → `use-evidence`; all input combinations from `data-model.md`.
- [ ] T010 [P] [US6] Write failing tests extending `tests/unit/persistence/EvidenceRepository.test.ts`: `resolveReferencedImageEvidence` keyed by `RequestClassification.referencedImageId` never returns a different image's evidence.

### Implementation for Image Continuity

- [ ] T011 [US4] Wire `evaluateImageEvidenceAvailability` into `ContextOrchestrator` for `isNewImageQuestion`, aligning with the existing `messageHasImage`/active-image-turn handling. (depends on T006, T009)
- [ ] T012 [US5] Extend orchestrator wiring for `isSameImageFollowUp`: reuse stored evidence, no reprocessing, and no evidence attached when the follow-up carries no visual/reference signal. (depends on T011)
- [ ] T013 [US6] Extend orchestrator wiring for `isOlderImageReference`: resolve via `referencedImageId` through `EvidenceRepository.resolveReferencedImageEvidence`; missing-original + non-pixel-dependent → `use-evidence`; missing-original + pixel-dependent → `original-unavailable`. (depends on T010, T011)
- [ ] T014 [US7] Implement the `use-original` re-inference trigger in `src/inference/InferenceService.ts` + `src/persistence/EvidenceRepository.ts`: issue a new vision-inference call through the existing single-flight `InferenceQueue`/`DeviceResourcePolicy`, persist a new versioned evidence row linked to the same `image_asset_id`. (depends on T009, T011)
- [ ] T015 [US7] Replace the Phase 2 observation-only `imageDecision` diagnostics placeholder with the real, behaviorally-selected decision for every image classification. (depends on T014)

**Checkpoint**: Image continuity and pixel-dependent re-inference are behaviorally correct and independently testable (spec MV-003, MV-004, MV-005, MV-006).

---

## Phase 4: User Stories 1, 2, 3, 8 — Minimal-Context Routing (Priority: P1/P1/P1/P3)

**Goal**: Independent, self-contained questions receive zero conversational context; text follow-ups receive only what their reference requires; long-context retrieval requests stay coherent and bounded; voice-transcribed questions route identically to typed text.

**Independent Test**: Ask an independent factual question in a chat with unrelated history/facts/summary/image → zero non-current-request sources considered. Ask a follow-up with a clear reference → only the needed recent turns included. Ask about an earlier topic in a long conversation → relevant facts/summary/retrieval included, unrelated independent questions still get nothing extra.

### Tests for Minimal-Context Routing ⚠️ (write first, must fail)

- [ ] T016 [P] [US1] Write failing tests extending `tests/unit/inference/ContextOrchestrator.test.ts`: an independent-question classification yields zero prior turns/summary/facts/retrieval/image evidence **considered**, even when all of them exist and would otherwise qualify.
- [ ] T017 [P] [US2] Write failing tests for follow-up scoping: recent turns included up to the mode's floor; no unrelated retrieval/summary pulled in absent a supporting classification.
- [ ] T018 [P] [US3] Write failing tests for long-context-retrieval-request selection (facts/summary/same-chat retrieval included when relevant, excluded for an independent question in the same long conversation) and for deterministic repeatability of selection given identical input/state/mode/embedding-version.

### Implementation for Minimal-Context Routing

- [ ] T019 [US1] Implement the hard-skip gate in `ContextOrchestrator.orchestrate()`: for `isIndependentTextQuestion` with no co-occurring image/long-context classification, short-circuit before querying the evidence repository, retriever, or fact/summary sources. (depends on T016; make T016 pass)
- [ ] T020 [US2] Implement follow-up-scoped source resolution: recent-turn inclusion gated on `isTextFollowUp`, unchanged priority order otherwise. (depends on T017, T019)
- [ ] T021 [US3] Implement long-context-retrieval-request source resolution: facts/summary/same-chat retrieval gated on `isLongContextRetrievalRequest`. (depends on T018, T020)
- [ ] T022 [P] [US8] Write and pass an integration regression test in `tests/integration/voiceRouting.test.ts` confirming a transcribed-and-submitted voice message produces identical `RequestClassification` and identical selected context to typed text with the same content — no new production code expected. (depends on T021)

**Checkpoint**: Spec MV-001, MV-002, MV-003, and MV-009 all pass; classification-gated routing fully replaces today's fixed-assembly behavior.

---

## Phase 5: Token Budgeting (serves US1, US3, US6)

**Goal**: Replace character-based context budgeting with a token-aware (or calibrated token-equivalent) measurement, reconciled with the existing hard `ContextWindow` trim, while preserving protected-source and eviction-order guarantees.

**Independent Test**: Export diagnostics across Low/Medium/High modes and confirm budget units are token-denominated; construct a near-limit conversation and confirm the router never selects a set that `ContextWindow`'s downstream trim would still need to cut; confirm the current request and active/referenced image evidence are never evicted under a deliberately tight budget.

### Tests for Token Budgeting ⚠️ (write first, must fail)

- [ ] T023 [P] [US3] Write failing tests for the new token-based `ContextBudgetPolicy` implementation in `tests/unit/inference/TokenContextBudgetPolicy.test.ts`: `measure()` returns a calibrated token estimate (not `content.length`), per-mode budgets stay monotonic, output is deterministic.
- [ ] T024 [P] [US1] Write failing tests asserting the current request is never evicted, even under a deliberately tiny budget.
- [ ] T025 [P] [US6] Write failing tests asserting active/referenced image evidence is never evicted and that the eviction order (cross-chat → same-chat retrieved → facts → summary) holds under budget pressure.
- [ ] T026 [P] [US3] Write failing reconciliation tests asserting the router's `maximumUnits` for a given mode never exceeds what `ContextWindow`'s hard trim allows for that mode (spec FR-027, MV-007).

### Implementation for Token Budgeting

- [ ] T027 [US3] Implement `TokenContextBudgetPolicy` (`policyId: 'token-estimate-budget-v1'`) in `src/inference/ContextOrchestrator.ts`, replacing `CharacterContextBudgetPolicy` as the runtime default. (make T023 pass)
- [ ] T028 [US6] Verify/adjust protected-source and eviction-order logic against the new token measurement — same algorithm, new unit semantics. (make T024, T025 pass)
- [ ] T029 [US3] Reconcile the router's per-mode `maximumUnits` with `ContextWindow`'s existing `QWEN_CONTEXT_TOKEN_LIMIT - generationLimit - CONTEXT_SAFETY_TOKENS` calculation in `src/inference/ContextWindow.ts`, sharing one constant/calculation. (make T026 pass)
- [ ] T030 [US3] Recalibrate the three response-mode budgets from characters to tokens in `src/inference/ResponseMode.ts`, using the ratio from `research.md` §1 as the starting point (final numbers per spec Open Questions/evaluation harness).

**Checkpoint**: Spec MV-007 passes; budgets are token-denominated and reconciled with the real model context window.

---

## Phase 6: User Story 10 — Generation and Repetition Improvements (Priority: P2)

**Goal**: Independent/short-follow-up questions get concise, non-padded answers regardless of mode; emerging loops stop generation earlier instead of running to the hard limit; existing post-processing is preserved and may be improved.

**Independent Test**: Ask a short independent question in each mode → answer length trends short, not padded to the mode's soft target. Trigger a known loop-prone prompt → generation stops noticeably earlier and the answer is still cleaned up.

### Tests for Generation and Repetition ⚠️ (write first, must fail)

- [ ] T031 [P] [US10] Write failing tests for `resolveGenerationTarget(mode, classification)` in `tests/unit/inference/GenerationTuning.test.ts`: reduced soft target for independent/short-follow-up classifications, unchanged for others, hard generation limit never reduced below safe completion room.
- [ ] T032 [P] [US10] Write failing tests for the streaming loop-detector's pure trigger function (buffer → loop-confirmed boolean) in `tests/unit/inference/AnswerPostProcessor.streaming.test.ts`, reusing `collapseLoopingTail`'s detection logic; do not pin exact stop timing (spec Section 12 exclusion).

### Implementation for Generation and Repetition

- [ ] T033 [US10] Implement `resolveGenerationTarget` in `src/inference/GenerationTuning.ts` and wire it into the answer-generation call site. (make T031 pass)
- [ ] T034 [US10] Implement the streaming loop-detector hook at the existing checkpoint-throttle cadence in `src/inference/llamaRn/QwenLlamaRuntime.ts`, calling the existing `stopCompletion()` path on a confirmed loop. (make T032 pass)
- [ ] T035 [US10] Run the existing `postProcessAnswer` pass on the early-stopped buffer exactly as on a normal completion; extend `src/inference/AnswerPostProcessor.ts` only if early-stopping introduces a new truncation shape to handle (spec FR-031, "may improve, not required to stay unchanged").

**Checkpoint**: Spec MV-010 passes; independent short-answer questions are concise; loop-prone fixtures stop earlier without affecting legitimate long High-mode answers.

---

## Phase 7: User Story 3 (continued) — Same-Chat Semantic and Hybrid Retrieval ⛔ GATED (Priority: P1)

**Goal**: Query-time embeddings are wired so `HybridRetriever` receives a real vector when the embedding runtime is active; lexical and semantic candidates are fused (RRF) instead of semantic silently overriding lexical.

**Independent Test**: With an approved embedding runtime, ask a question with both an exact lexical match and a semantically related but non-overlapping passage → both influence the fused result. Simulate a stale/incompatible embedding version → falls back to lexical-only without failing.

### Tests for Retrieval Fusion ⚠️ (write first, must fail)

- [ ] T036 [P] [US3] Write failing tests extending `tests/unit/retrieval/HybridRetriever.test.ts`: RRF-fused ranking never drops a top lexical match, dedup by source message keeps the higher fused score, deterministic tie-break holds, and lexical-only fallback triggers when there is no query vector or embeddings are stale/incompatible.

### Implementation for Retrieval Fusion

- [ ] T037 **⛔ GATED (embedding manifest)** [US3] Implement query-time embedding generation in `ContextOrchestrator`/`src/store/conversationStore.ts`: call `EmbeddingService.embed([currentRequestText])` under the `DeviceResourcePolicy` `'embedding'` lease when the embedding runtime is active, and pass the result as `queryVector` into `HybridRetriever.search` (spec FR-015; ships inert/unreachable until the manifest is approved, same gate as Spec 006 T005).
- [ ] T038 **⛔ GATED (embedding manifest)** [US3] Implement RRF fusion (`k = 60`) in `src/retrieval/HybridRetriever.ts`, replacing "semantic overrides lexical" with combined-ranking fusion, dedup, and tie-break. (make T036 pass)

**Checkpoint**: Retrieval fusion code is complete and tested but remains behind the pre-existing embedding-manifest approval gate; the app continues to serve lexical-only results until that approval lands.

---

## Phase 8: User Story 9 — Optional Scoped Cross-Chat Retrieval (Priority: P3, built only once Phases 3–6 are validated stable)

**Goal**: A global, off-by-default setting lets relevant content from other local, non-excluded conversations inform answers; any conversation can be individually excluded in both directions; disabling takes effect immediately.

**Independent Test**: With the setting off (default), no chat ever includes another conversation's content. Enable it → relevant content from another chat appears, attributed and untrusted. Exclude a conversation → it stops contributing/receiving cross-chat content even while the global setting stays on. Disable the setting → the very next message in every chat stops including cross-chat content.

### Tests for Cross-Chat Retrieval ⚠️ (write first, must fail)

- [ ] T039 [P] [US9] Write failing migration tests extending `tests/unit/persistence/Migrations.test.ts`: `SCHEMA_VERSION` 3→4 adds `excluded_from_cross_chat`, existing rows default to `0`, migration applies transactionally.
- [ ] T040 [P] [US9] Write failing tests in `tests/unit/retrieval/HybridRetriever.crossChat.test.ts`: scope unchanged when the setting is off; scope expands to non-excluded local conversations when on; an excluded conversation is isolated in both directions; scope-before-scoring is preserved.

### Implementation for Cross-Chat Retrieval

- [ ] T041 [US9] Add the `excluded_from_cross_chat` migration entry in `src/persistence/sqlite/Migrations.ts` and `setCrossChatExcluded`/read exposure in `src/persistence/ConversationRepository.ts`. (make T039 pass)
- [ ] T042 [US9] Add `crossChatMemoryEnabled` (default `false`) to `src/store/settingsStore.ts`, mirroring the existing `defaultResponseMode` MMKV pattern.
- [ ] T043 [US9] Extend `HybridRetriever`/`ContextOrchestrator` scope resolution to expand `conversationIds` when cross-chat is enabled and the current conversation isn't excluded. (make T040 pass; depends on T037/T038's fusion-capable `HybridRetriever` existing, even while gated)
- [ ] T044 [US9] Add the global cross-chat settings-row toggle (`src/components/settings/CrossChatSettingRow.tsx`) and a per-conversation exclusion control, using existing `design/` tokens and shared settings components (spec Non-Goal: no new picker UX).
- [ ] T045 [US9] Replace the Phase 2 always-`false` `crossChatActive` diagnostics placeholder with real per-turn usage.

**Checkpoint**: Spec MV-008 passes; cross-chat is off by default, opt-in, per-conversation-excludable, and immediately reversible.

---

## Phase 9: User Story 10 (continued) — Optional Grounding Diagnostics (Priority: P2, built only once Phases 3–8 are validated stable)

**Goal**: A deterministic, diagnostics-only assessment flags answers whose specific claims aren't supported by the evidence/retrieved text actually included in context — no visible answer change, no second model-generation pass.

**Independent Test**: Ask a pixel-dependent question with clear supporting evidence → `groundingVerdict: 'supported'`. Construct a case where the answer states a claim absent from the included evidence → `groundingVerdict: 'unsupported'` appears in diagnostics only.

- [ ] T046 [US10] Design and pin the deterministic claim-extraction/comparison heuristic (research.md §7 direction) with its own failing test suite in `tests/unit/inference/GroundingAssessment.test.ts` (write first).
- [ ] T047 [US10] Implement the heuristic in new `src/inference/GroundingAssessment.ts`, invoked only for turns that included image evidence or retrieved text, writing `groundingVerdict` to diagnostics only. (make T046 pass; spec FR-036)

**Checkpoint**: Grounding assessment is diagnostics-only and does not alter any visible answer; `quickstart.md` Phase 8 validation passes.

---

## Phase 10: Polish & Integration Validation

**Purpose**: Full regression pass, cross-phase validation, and documentation alignment.

- [ ] T048 [P] Run `npm run type-check`, `npm run lint`, and the five focus-area test suites (spec Section 12) across the full feature; fix any regressions.
- [ ] T049 Run the full manual validation pass (spec Section 11, MV-001–MV-011) against the Phase 0 baseline fixtures recorded in T001; record a before/after comparison.
- [ ] T050 Run the Spec 006 physical-device regression checklist (History pagination/search, model download/verify, generation cancellation, checkpoint/recovery, durable images, offline/airplane-mode) per spec MV-011; confirm zero regression.
- [ ] T051 [P] Execute `quickstart.md` Phases 1–9 end-to-end on a physical device and record results/deviations.
- [ ] T052 Update `AGENTS.md`/`README.md` only if this feature changes a previously documented architecture claim (e.g., character-based → token-based budgeting); otherwise skip.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user-story phases.
- **Phase 3 (US4/5/6/7, image continuity)**: Depends on Foundational. Ships first among story phases per spec Section 14.
- **Phase 4 (US1/2/3/8, minimal-context routing)**: Depends on Phase 3 (routing gating builds on the image-aware resolution wired there).
- **Phase 5 (token budgeting)**: Depends on Phase 4 (needs classification-gated selection in place before its budget can be meaningfully measured/evicted).
- **Phase 6 (US10, generation/repetition)**: Depends on Phase 5.
- **Phase 7 (US3 continued, retrieval fusion, ⛔ gated)**: Depends on Phase 6.
- **Phase 8 (US9, cross-chat)**: Depends on Phases 3–6 being stable (spec Section 14: "built once Phases 1–5 are stable"); also depends on Phase 7's `HybridRetriever` fusion code existing (even while gated), since cross-chat scope wraps the same function.
- **Phase 9 (US10 continued, grounding)**: Depends on Phases 3–8 being stable.
- **Polish (Phase 10)**: Depends on all implemented phases.

### User Story Dependencies

Unlike a typical spec where stories are independent from Foundational onward, this feature has an **authored, non-negotiable phase order** (spec Section 14): US4/US5/US6/US7 (image) → US1/US2/US3/US8 (routing) → token budgeting → US10 (generation) → US3 continued (retrieval fusion) → US9 (cross-chat) → US10 continued (grounding). Stories are still independently testable at their own checkpoint (each phase has its own Independent Test), but they are **not** independently sequenced — do not start a later phase's story before its prerequisite phase's checkpoint passes.

### Within Each Phase

- Tests MUST be written and FAIL before implementation (Constitution VI).
- Diagnostics/type extensions before behavioral wiring (Phase 2 pattern, reused at each phase where a diagnostics field goes from placeholder to real).
- Story complete (checkpoint passes) before moving to the next phase.

### Parallel Opportunities

- All Setup tasks (T001–T003) run in parallel.
- Within Foundational, T004/T005/T008 run in parallel; T006 depends on T005, T007 depends on T004+T006.
- Within each phase's Tests subsection, all `[P]`-marked tests run in parallel (different files).
- T009/T010 (Phase 3 tests) run in parallel; implementation tasks T011→T012→T013→T014→T015 are sequential (same file, layered wiring).
- T016/T017/T018 (Phase 4 tests) run in parallel; T019→T020→T021 are sequential (same orchestrator file); T022 is independent once T021 lands.
- T023–T026 (Phase 5 tests) run in parallel; T027–T030 are largely sequential (same files/shared constant).
- T031/T032 (Phase 6 tests) run in parallel; T033/T034 can run in parallel (different files), T035 depends on T034.
- T039/T040 (Phase 8 tests) run in parallel; T041/T042 run in parallel, T043 depends on both, T044/T045 run in parallel after T043.

---

## Parallel Example: Phase 3 (Image Continuity)

```bash
# Tests first (must fail):
Task: "T009 pixel-dependent policy tests in tests/unit/inference/ImageEvidencePolicy.test.ts"
Task: "T010 older-image resolution tests in tests/unit/persistence/EvidenceRepository.test.ts"

# Then sequential wiring (same orchestrator file):
Task: "T011 wire new-image-question resolution"
Task: "T012 wire same-image-follow-up reuse"
Task: "T013 wire older-image-reference resolution"
Task: "T014 implement use-original re-inference trigger"
```

---

## Implementation Strategy

### MVP Scope

This feature's spec explicitly mandates a phase order (Section 14) that does **not** start with the highest-priority user story alone — image continuity (US4/5/6/7) ships before minimal-context routing (US1/2/3), because the router's classification and image-decision fields need to exist and be observable (Phase 2) before either behavioral slice lands, and image continuity was ordered first among the two. The realistic MVP checkpoint is therefore **Setup + Foundational + Phase 3 + Phase 4** (T001–T022): at that point, independent questions get zero context, follow-ups get only what they need, long conversations stay bounded, image continuity (including pixel-dependent re-inference) works end-to-end, and voice-transcribed input is confirmed to route identically — covering 8 of the 10 user stories' core behavior (US1, US2, US3, US4, US5, US6, US7, US8).

### Incremental Delivery

1. Setup + Foundational → classification/diagnostics observable, no behavior change.
2. Phase 3 (image) → Phase 4 (routing) → **MVP checkpoint**, validate against `quickstart.md` Phases 1–3.
3. Phase 5 (token budgeting) → validate MV-007.
4. Phase 6 (generation/repetition) → validate MV-010.
5. Phase 7 (retrieval fusion, gated) → ships inert until the embedding manifest is approved.
6. Phase 8 (cross-chat) → validate MV-008, only after Phases 3–6 are confirmed stable in production use.
7. Phase 9 (grounding) → validate `quickstart.md` Phase 8, only after Phases 3–8 are confirmed stable.
8. Phase 10 → full regression and documentation pass.

---

## Notes

- Write one focused failing suite per invariant boundary, then implement — mirrors Spec 006's testing philosophy (reduced-test, not exhaustive). Pinned constants (RRF `k = 60`, `COSINE_SIMILARITY_THRESHOLD = 0.62`) are asserted inside their owning suites (T036, T038), not in separate micro-tests.
- Do not add UI snapshot tests, nondeterministic model-output assertions, or exact-wording checks anywhere in this feature (spec Section 12).
- T037/T038 (Phase 7) and any embedding-dependent portion of Phase 8 (T043) MUST NOT be merged as reachable/enabled production behavior until the pre-existing embedding-artifact approval lands — they ship as tested, dead code behind the existing lexical-fallback path, exactly like `EmbeddingService`/`EmbeddingBackfill` do today.
- Commit by logical phase rather than one commit per task, consistent with Spec 006 practice.
