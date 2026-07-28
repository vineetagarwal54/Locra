---
description: "Task list for Context Routing and Answer Quality"
---

# Tasks: Context Routing and Answer Quality

**Input**: Design documents from `specs/007-context-routing-and-answer-quality/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED but intentionally focused, per spec Section 12: only the five named high-risk areas (request routing, image-reference and missing-image selection, token-budget protection and eviction, lexical/semantic fusion and fallback, cross-chat isolation) get failing-test-first coverage (Constitution VI). Generation-quality work (Phase 5) and the optional grounding heuristic (Phase 8) are explicitly **not** in that list — they are implemented and validated manually/via the evaluation harness, not via new required unit tests (spec Section 12 exclusions). No tests are added anywhere for exact answer wording, OCR/counting accuracy, tone, visual correctness, or general response quality.

**Organization**: Grouped by the 10 user stories from spec.md; phase numbers match `plan.md`'s Implementation Phases and spec Section 14's canonical 9-phase sequencing exactly (Setup precedes Phase 1 and is not itself numbered in that list).

**Gates**: Phase 6 (same-chat semantic/hybrid retrieval) is **⛔ GATED** behind the pre-existing embedding-artifact approval (model identity, license, hash, dimensions, latency, memory, device compatibility) established in Spec 006 — the same gate that already blocks `EmbeddingService`/`EmbeddingBackfill` today. Gated tasks ship code that remains inert (lexical-fallback only) until that approval lands.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US10 (Setup/Phase 1/Polish carry no story label)

## Path Conventions

Single Expo/React Native app. Source under `src/`; focused unit tests under `tests/unit/`, cross-module flow tests under `tests/integration/` (matches Spec 006 conventions).

---

## Setup

**Purpose**: Baseline fixtures and dependency re-verification before any implementation.

- [X] T001 [P] Record baseline evaluation fixtures for independent-question, follow-up, image (new/same/older/ambiguous/pixel-dependent), long-conversation, and repetition/verbosity scenarios in `src/evaluation/baselines/`, for later before/after comparison (spec MV-001–MV-011).
- [X] T002 [P] Re-verify `llama.rn`'s `tokenize()`, `detokenize()`, and `stopCompletion()` call shapes against the currently linked `llama.rn` version (`node_modules/llama.rn/src/index.ts`) and record confirmation in `research.md` (Constitution IX).
- [X] T003 [P] Run `npm run type-check`, `npm run lint`, and `npm test` on the unchanged branch and record the baseline result before implementation.

---

## Phase 1: Diagnostics-Only Routing Visibility

**Purpose**: Build the classification engine and extend diagnostics types in **observation-only** mode — computed and recorded, but not yet changing any answer's context — so every later phase can build on a stable `RequestClassifier` and diagnostics shape (spec Section 14, Phase 1).

**⚠️ CRITICAL**: No later phase may begin until this phase is complete.

- [X] T004 [P] Add the `RequestClassification` type (including `imageReferenceAmbiguous`) and extend `ContextSelectionDiagnostics`/`RankedCandidateDiagnostic` in `src/inference/ContextOrchestrator.ts` (and `src/types/models.ts` if needed) per `data-model.md`, without changing existing selection behavior yet.
- [X] T005 [P] Write failing tests for `RequestClassifier` in `tests/unit/inference/RequestClassifier.test.ts`: all 8 classification flags, `isIndependentTextQuestion`/`isTextFollowUp` mutual exclusivity, combinability of image/pixel/long-context/cross-chat-eligible flags, the conservative ambiguous-short-reply-defaults-to-follow-up rule, and the `imageReferenceAmbiguous` flag forcing `isSameImageFollowUp = true` / `isOlderImageReference = false` (contracts/request-routing.md, spec FR-012a).
- [X] T006 Implement `src/inference/RequestClassifier.ts` (`classifyRequest`) to make T005 pass. (depends on T005)
- [X] T007 Wire `classifyRequest` into `ContextOrchestrator.orchestrate()` in **observation-only** mode: record actual retrieval/source behavior separately from proposed Phase 3 routing, plus the real image decision and ambiguity resolution, without applying the Phase 3 hard skip. (depends on T004, T006)
- [X] T008 [P] Extend `src/diagnostics/DiagnosticsBundleBuilder.ts` and `src/diagnostics/DiagnosticsTraceStore.ts` to export the new classification/retrievalMode/imageDecision/imageReferenceAmbiguous/crossChatActive/groundingVerdict(`null`) fields per `contracts/diagnostics.md`.

**Checkpoint**: Classification and diagnostics are observable end-to-end; no answer behavior has changed yet.

---

## Phase 2: Image Identity, Reference Resolution, and Original-Pixel Follow-Ups

**User Stories**: US4 (new image), US5 (same-image follow-up), US6 (older-image and ambiguous-image reference), US7 (pixel-dependent re-inference) — Priorities P1/P1/P2/P1.

**Goal**: New image questions get evidenced; same-image follow-ups reuse evidence without reprocessing; unambiguous older-image references resolve to the correct image; a genuinely ambiguous reference defaults to the active image instead of guessing; pixel-dependent requests re-run the correct original image through the Qwen vision path.

**Independent Test**: Attach an image and ask about it (evidenced); ask a non-visual follow-up (no re-attach); attach a second image and reference the first (correct resolution); attach a third and ask ambiguously (defaults to active, flagged in diagnostics); ask a pixel-dependent follow-up (fresh re-inference, visible as a new evidence timestamp).

### Tests for Image Continuity ⚠️ (write first, must fail)

- [X] T009 [P] [US7] Write failing tests extending `tests/unit/inference/ImageEvidencePolicy.test.ts`: pixel-dependent + asset available → `use-original`; pixel-dependent + asset missing → `original-unavailable`; non-pixel-dependent + evidence available → `use-evidence`; all input combinations from `data-model.md`.
- [X] T010 [P] [US6] Write failing tests extending `tests/unit/persistence/EvidenceRepository.test.ts`: `resolveReferencedImageEvidence` keyed by `RequestClassification.referencedImageId` never returns a different image's evidence.
- [X] T011 [P] [US6] Write failing tests for the ambiguous-image-reference default in `tests/unit/inference/ContextOrchestrator.test.ts` (or a dedicated file): with two or more plausible images and no uniquely strongest ordinal/description match, the resolved decision matches a same-image follow-up against the current active image, `referencedImageId` is not guessed, and diagnostics record the ambiguity and fallback resolution (spec FR-012a).

### Implementation for Image Continuity

- [X] T012 [US4] Wire `evaluateImageEvidenceAvailability` into `ContextOrchestrator` for `isNewImageQuestion`, aligning with the existing `messageHasImage`/active-image-turn handling. (depends on T006, T009)
- [X] T013 [US5] Extend orchestrator wiring for `isSameImageFollowUp`: reuse stored evidence, no reprocessing, and no evidence attached when the follow-up carries no visual/reference signal. (depends on T012)
- [X] T014 [US6] Extend orchestrator wiring for an unambiguous `isOlderImageReference`: resolve via `referencedImageId` through `EvidenceRepository.resolveReferencedImageEvidence`; missing-original + non-pixel-dependent → `use-evidence`; missing-original + pixel-dependent → `original-unavailable`. (depends on T010, T012)
- [X] T015 [US6] Implement the ambiguous-image-reference default: when `imageReferenceAmbiguous` is true, resolve as `isSameImageFollowUp` against the active image and never call the referenced-image resolver with a guessed ID; record the resolution in diagnostics. (depends on T011, T014; make T011 pass)
- [X] T016 [US7] Implement the `use-original` re-inference trigger in `src/inference/InferenceService.ts` + `src/persistence/EvidenceRepository.ts`: issue a new vision-inference call through the Qwen path via the existing single-flight `InferenceQueue`/`DeviceResourcePolicy`, persist a new versioned evidence row linked to the same `image_asset_id`. Applies identically whether the pixel-dependent request targets the active image or an unambiguously referenced older image. (depends on T009, T012, T014)
- [X] T017 [US7] Replace the Phase 1 observation-only `imageDecision`/`imageReferenceAmbiguous` diagnostics placeholders with the real, behaviorally-selected decision for every image classification. (depends on T015, T016)

**Checkpoint**: Image continuity, ambiguous-reference safety, and pixel-dependent re-inference are behaviorally correct and independently testable (spec MV-004–MV-009).

---

## Phase 3: Minimal-Context Request Routing

**User Stories**: US1 (independent question), US2 (text follow-up), US3 (long-context retrieval), US8 (voice parity) — Priorities P1/P1/P1/P3.

**Goal**: Independent, self-contained questions receive zero conversational context; text follow-ups receive only what their reference requires; long-context retrieval requests stay coherent and bounded; voice-transcribed questions route identically to typed text (validated manually, no dedicated automated test — see Checkpoint).

**Independent Test**: Ask an independent factual question in a chat with unrelated history/facts/summary/image → zero non-current-request sources considered. Ask a follow-up with a genuine reference → only the needed recent turns included. Ask about an earlier topic in a long conversation → relevant facts/summary/retrieval included, unrelated independent questions still get nothing extra.

### Tests for Minimal-Context Routing ⚠️ (write first, must fail)

- [X] T018 [P] [US1] Write failing tests extending `tests/unit/inference/ContextOrchestrator.test.ts`: an independent-question classification yields zero prior turns/summary/facts/retrieval/image evidence **considered**, even when all of them exist and would otherwise qualify, and confirm no recent-turn floor is applied at all for this classification (not merely reduced to zero).
- [X] T019 [P] [US2] Write failing tests for follow-up scoping: recent turns included up to the mode's floor; no unrelated retrieval/summary pulled in absent a supporting classification.
- [X] T020 [P] [US3] Write failing tests for long-context-retrieval-request selection (facts/summary/same-chat retrieval included when relevant, excluded for an independent question in the same long conversation) and for deterministic repeatability of selection given identical input/state/mode/embedding-version.

### Implementation for Minimal-Context Routing

- [X] T021 [US1] Implement the hard-skip gate in `ContextOrchestrator.orchestrate()`: for `isIndependentTextQuestion` with no co-occurring image/long-context classification, short-circuit before querying the evidence repository, retriever, or fact/summary sources, and before any recent-turn-floor logic runs. (depends on T018; make T018 pass)
- [X] T022 [US2] Implement follow-up-scoped source resolution: recent-turn inclusion gated on `isTextFollowUp`, unchanged priority order otherwise. (depends on T019, T021)
- [X] T023 [US3] Implement long-context-retrieval-request source resolution: facts/summary/same-chat retrieval gated on `isLongContextRetrievalRequest`. (depends on T020, T022)

**Checkpoint**: Spec MV-001, MV-002, MV-003, and MV-010 all pass; classification-gated routing fully replaces today's fixed-assembly behavior. Manually verify MV-012 (voice-transcribed text routes identically to typed text with the same content) — no dedicated automated test is added for this per spec Section 12; it is a direct consequence of routing keying only off message content.

---

## Phase 4: Model-Aware Token Budgeting

**Serves**: US1, US3, US6 (no dedicated user story of its own; a cross-cutting requirement, Section 8).

**Goal**: Replace character-based context budgeting with calibrated selection plus
bounded repeated native prompt verification, reserve distinct capacity for system
instructions / current input / image input / selected context / generated output,
and apply the documented eviction order without an unconditional recent floor.

**Independent Test**: Export diagnostics across Low/Medium/High modes and confirm budget units are token-denominated and bucketed; construct a near-limit conversation and confirm the router never selects a set that `ContextWindow`'s downstream trim would still need to cut; confirm the current request and active/referenced image evidence are never evicted, and that an independent question shows no recent-turn-floor entry at all.

### Tests for Token Budgeting ⚠️ (write first, must fail)

- [X] T024 [P] [US3] Write failing tests for the new token-based `ContextBudgetPolicy` implementation in `tests/unit/inference/TokenContextBudgetPolicy.test.ts`: `measure()` returns a calibrated (tier-1) token estimate (not `content.length`), per-mode budgets stay monotonic, output is deterministic.
- [X] T025 [P] [US1] Write failing tests asserting the current request is never evicted, even under a deliberately tiny budget, and that an independent-question turn shows zero recent-turn-floor consumption (not a protected-but-empty floor).
- [X] T026 [P] [US6] Write failing tests asserting active/referenced image evidence is never evicted, large protected evidence first displaces lower-priority context, final `usedUnits <= maximumUnits`, and the eviction order (cross-chat → same-chat retrieved → facts → summary → recent-turn floor, only for a request that has one) holds under budget pressure.
- [X] T027 [P] [US3] Write failing reconciliation tests asserting the router's `maximumUnits` (selected-context-pool bucket) for a given mode never exceeds what `ContextWindow`'s hard trim allows for that mode once the other four buckets are subtracted (spec FR-027, MV-016).
- [X] T028 [P] [US3] Write failing tests for the five reserved-capacity buckets (spec FR-026a): buckets never sum above `QWEN_CONTEXT_TOKEN_LIMIT - CONTEXT_SAFETY_TOKENS`; the selected-context pool cannot be sized into headroom reserved for system instructions, current input, image input, or generated output.

### Implementation for Token Budgeting

- [X] T029 [US3] Implement `TokenContextBudgetPolicy` (`policyId: 'token-estimate-budget-v1'`, tier-1 calibrated estimator) in `src/inference/ContextOrchestrator.ts`, replacing `CharacterContextBudgetPolicy` as the runtime default. `responseModeBudgetPolicy()` MUST preserve the concrete token policy and MUST NOT recreate `CharacterContextBudgetPolicy`; diagnostics MUST report the effective policy's `policyId`, not the constructor's stale base id. (make T024 pass)
- [X] T030 [US6] Fix protected-source and eviction-order logic against the new token measurement: cross-chat → same-chat retrieved → facts → summary → recent-turn floor **only when a floor applies** to this request's classification; current request and protected image evidence are never reached. Update `selectProtectedEvidence` and `selectProtectedContextEvidence` (and equivalent protected-image paths) so referenced image evidence cannot be dropped incorrectly under the selected-context budget. (make T025, T026 pass)
- [X] T031 [US3] Implement bounded tier-2 reconciliation: format and tokenize the final Qwen prompt, evict eligible context and re-tokenize when over limit, then shorten the current request from its measured native excess (preserving head, tail, marker, and image media path) and perform a final fitting check. Use a small explicit pass cap and never call completion with an unverified over-limit prompt. (make T027 pass)
- [X] T032 [US3] Implement the five reserved-capacity buckets (system instructions, current input, image input, selected-context pool, generated output) in `src/inference/ContextOrchestrator.ts`/`src/inference/ContextWindow.ts`, wiring existing constants (`IMAGE_RESERVE_TOKENS`, `getResponseGenerationLimit`) into the shared accounting. (make T028 pass)
- [X] T033 [US3] Recalibrate the three response-mode budgets from characters to the selected-context-pool token bucket in `src/inference/ResponseMode.ts`, using the ratio from `research.md` §1 as the starting point (final numbers per spec Open Questions/evaluation harness).

**Checkpoint**: Spec MV-016 passes; budgets are token-denominated, bucketed, and reconciled with the real model context window; independent questions show no recent-turn-floor artifact.

---

## Phase 5: Generation Length, Repetition, and Stopping Improvements

**User Story**: US10 (generation stays concise, avoids repetition, stops loops earlier) — Priority P2.

**Goal**: Independent/short-follow-up questions get concise, non-padded answers regardless of mode; genuinely detailed requests are not shortened; emerging loops stop generation earlier using runtime-verified controls instead of running to the hard limit; interrupted generation preserves partial text; existing post-processing is preserved and may be improved.

**Independent Test**: Ask a short independent question in each mode → answer length trends short, not padded to the mode's soft target. Ask a genuinely detailed question → length is not artificially reduced. Trigger a known loop-prone prompt → generation stops noticeably earlier, partial text is preserved, and the answer is still cleaned up.

Generation quality remains outside the five required automated-test areas, but deterministic mocked correction tests cover stop ownership, finish-reason handling, partial-buffer preservation, and cancellation idempotence. Native acceptance remains manual.

- [ ] T034 Re-verify `stopCompletion()` against the linked `llama.rn` version and validate on a physical device that it stops native completion, preserves and persists partial text, releases the resource lease, permits the next inference, and does not race/double-complete with user cancellation. Source/API verification and deterministic mocked coverage are complete; native hardware acceptance remains pending (spec FR-036a, Constitution IX). (depends on T002)
- [X] T035 [US10] Implement `resolveGenerationTarget(mode, classification)` in `src/inference/GenerationTuning.ts` and wire it into the answer-generation call site: reduced soft target for independent/short-follow-up classifications; unchanged or unshortened target for long-context/detailed requests; hard generation limit never reduced below safe completion room.
- [X] T036 [US10] **Automated implementation complete; hardware acceptance pending under T034.** Implement the streaming loop detector in `src/inference/llamaRn/QwenLlamaRuntime.ts` as the single authoritative native loop-stop owner, make cancellation idempotent, return a completed `looping` result with cleaned partial text, and prevent queue-level duplicate stop/cancellation paths. Deterministic mocked tests pass; this checkbox does not claim physical-device acceptance. (hardware acceptance depends on T034)
- [X] T037 [US10] Run the existing `postProcessAnswer` pass on the early-stopped buffer exactly as on a normal completion; extend `src/inference/AnswerPostProcessor.ts` only if early-stopping introduces a new truncation shape to handle (spec FR-031, "may improve, not required to stay unchanged"). (depends on T036)
- [X] T056 Correct the output-limit regression by separating soft targets from
  hard safety limits, restoring 320/640/1024 for ordinary visible prose and
  continuations, propagating one effective native limit, and making diagnostics
  report that actual value.
- [X] T057 Clarify retrieved-context trust so factual conversation data remains
  answerable while embedded instructions remain non-authoritative; deliver
  separately labeled, provenance-bearing multi-image evidence in final messages.
- [ ] T058 Re-run the output-truncation, retrieval-memory, and multi-image
  comparison matrix on a physical device. Reject mid-sentence/mid-list hard-cap
  endings and do not claim success until all effective-limit diagnostics match
  observed native behavior.

**Checkpoint**: Spec MV-011 passes manually; independent short-answer questions are concise; genuinely detailed answers are unaffected; loop-prone fixtures stop earlier without losing partial text.

---

## Phase 6: Same-Chat Semantic Embedding Activation and Hybrid Fusion ⛔ GATED

**User Story**: US3 (continued — long-context retrieval quality) — Priority P1.

**Goal**: Query-time embeddings are wired so `HybridRetriever` receives a real vector when the embedding runtime is active; lexical and semantic candidates are fused (RRF) instead of semantic silently overriding lexical, with a guarantee that exact matches on names/numbers/prices/dates/identifiers are never dropped by fusion.

**Independent Test**: With an approved embedding runtime, ask a question with both an exact lexical match and a semantically related but non-overlapping passage → both influence the fused result and the exact match survives. Simulate a stale/incompatible embedding version, or an embedding-call failure → falls back to lexical-only without failing.

### Tests for Retrieval Fusion ⚠️ (write first, must fail)

- [X] T038 [P] [US3] Write failing tests extending `tests/unit/retrieval/HybridRetriever.test.ts`: RRF-fused ranking never drops a top lexical match; exact matching retains first-position and multi-word proper names plus numbers/prices/dates/IDs while filtering generic command/question openers; dedup/tie-break remain deterministic; and lexical fallback covers missing/inactive/failing embeddings with zero compatible-vector lookup when no query vector exists.

### Implementation for Retrieval Fusion

- [X] T039 **⛔ GATED (embedding manifest)** [US3] Run deterministic classification before query-vector generation. Call `EmbeddingService.embed([currentRequestText])` under its existing device-resource lease only for eligible same-chat long-context or explicit cross-chat-memory retrieval, with retry/regenerate parity and lexical fallback on error. Independent questions, ordinary non-retrieval follow-ups, continuations without retrieval classification, and an inactive manifest make zero embedding calls (spec FR-015; remains inert until approval).
- [X] T040 **⛔ GATED (embedding manifest)** [US3] Implement RRF fusion (`k = 60`) in `src/retrieval/HybridRetriever.ts`, replacing "semantic overrides lexical" with combined-ranking fusion, dedup, and tie-break. (make T038's non-exact-match assertions pass)
- [X] T041 **⛔ GATED (embedding manifest)** [US3] Implement the exact-match guarantee (spec FR-019a) as a deterministic post-fusion step: retain proper and multi-word names even at query position zero, plus verbatim numbers/prices/dates/identifiers, while excluding generic sentence-opening commands before applying the limit. (depends on T040; make T038 pass)

**Checkpoint**: Retrieval fusion and the exact-match guarantee are complete and tested but remain behind the pre-existing embedding-manifest approval gate; the app continues to serve lexical-only results until that approval lands.

---

## Phase 7: Optional Scoped Cross-Chat Retrieval

**User Story**: US9 — Priority P3, built only once Phases 1–6 are validated stable.

**Goal**: A global, off-by-default setting lets relevant content from other local, non-excluded conversations inform answers; any conversation can be individually excluded in both directions; disabling takes effect immediately.

**Independent Test**: With the setting off (default), no chat ever includes another conversation's content. Enable it → relevant content from another chat appears, attributed and untrusted. Exclude a conversation → it stops contributing/receiving cross-chat content even while the global setting stays on. Disable the setting → the very next message in every chat stops including cross-chat content.

### Tests for Cross-Chat Retrieval ⚠️ (write first, must fail)

- [X] T042 [P] [US9] Write failing migration tests extending `tests/unit/persistence/Migrations.test.ts`: `SCHEMA_VERSION` 3→4 adds `excluded_from_cross_chat`, existing rows default to `0`, migration applies transactionally.
- [X] T043 [P] [US9] Write failing cross-chat tests covering new and short chats, explicit prior-conversation/memory language, ordinary independent questions, global off/immediate disable, bilateral current/source exclusions, scope-before-scoring, and accurate queried/selected diagnostics.

### Implementation for Cross-Chat Retrieval

- [X] T044 [US9] Add the `excluded_from_cross_chat` migration entry in `src/persistence/sqlite/Migrations.ts` and `setCrossChatExcluded`/read exposure in `src/persistence/ConversationRepository.ts`. (make T042 pass)
- [X] T045 [US9] Add `crossChatMemoryEnabled` (default `false`) to `src/store/settingsStore.ts`, mirroring the existing `defaultResponseMode` MMKV pattern.
- [X] T046 [US9] Extend scope resolution independently from same-chat long-context eligibility: explicit prior-conversation/memory requests may expand `conversationIds` in new or short chats when enabled and not excluded; ordinary questions never expand scope. Resolve eligible IDs before lexical/semantic scoring and record cross-chat queried/selected counts. (make T043 pass)
- [X] T047 [US9] Add the global cross-chat settings-row toggle (`src/components/settings/CrossChatSettingRow.tsx`) and a per-conversation exclusion control, using existing `design/` tokens and shared settings components (spec Non-Goal: no new picker UX).
- [X] T048 [US9] Replace the Phase 1 always-`false` `crossChatActive` diagnostics placeholder with real per-turn usage.

**Checkpoint**: Spec MV-014 passes; cross-chat is off by default, opt-in, per-conversation-excludable, and immediately reversible.

---

## Phase 8: Optional Grounding Diagnostics

**User Story**: US10 (deferred item) — Priority P2, built only once Phases 1–7 are validated stable. Not part of this feature's core delivery or core required tests (spec Section 12).

**Goal**: A deterministic, diagnostics-only assessment flags answers whose specific claims aren't supported by the evidence/retrieved text actually included in context — no visible answer change, no second model-generation pass, never an automatic rewrite or suppression of the answer.

**Independent Test**: Ask a pixel-dependent question with clear supporting evidence → `groundingVerdict: 'supported'`. Construct a case where the answer states a claim absent from the included evidence → `groundingVerdict: 'unsupported'` appears in diagnostics only, with no change to the visible answer.

- [X] T049 **OPTIONAL — requires separate approval** [US10] If Phase 8 is separately approved, design the deterministic claim-extraction/comparison heuristic from `research.md` §7. A small deterministic pure-function test MAY be approved with that work, but no failing grounding test suite is mandatory under this feature's five required automated-test areas.
- [X] T050 **OPTIONAL — requires separate approval** [US10] If approved, implement the heuristic in new `src/inference/GroundingAssessment.ts` using selected conversation/retrieved context plus the current turn's fresh `hiddenEvidence` for new-image and re-inference turns. Fresh evidence is diagnostics-only, does not mutate canonical context, and never alters/retries/blocks the visible answer. (spec FR-036)

**Checkpoint**: Grounding assessment is diagnostics-only and does not alter any visible answer; `quickstart.md` Phase 8 validation passes.

---

## Phase 9: Final Manual Device Validation

**Purpose**: Full manual validation matrix, regression pass, and documentation alignment.

- [X] T051 [P] Run the complete validation commands: `npm run type-check`, `npm run lint`, and `npm test -- --runInBand`; fix any regressions. Focused suites MAY also run for iteration but MUST NOT replace the complete Jest suite.
- [ ] T052 Run the full manual validation matrix (spec Section 11, MV-001–MV-018) against the Setup baseline fixtures recorded in T001; record a before/after comparison.
- [ ] T053 Run the final airplane-mode validation (MV-017): confirm zero network calls across classification, image re-inference, token budgeting, retrieval fusion (if active), cross-chat scope resolution (if active), and generation controls.
- [ ] T054 Run the Spec 006 physical-device regression checklist (History pagination/search, model download/verify, generation cancellation, checkpoint/recovery, durable images) per spec MV-018; confirm zero regression.
- [ ] T055 [P] Execute `quickstart.md` Phases 1–9 end-to-end on a physical device and record results/deviations.
- [X] T056 Update `AGENTS.md`/`README.md` only if this feature changes a previously documented architecture claim (e.g., character-based → token-based budgeting); otherwise skip.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup**: No dependencies — can start immediately.
- **Phase 1 (diagnostics-only routing visibility)**: Depends on Setup — BLOCKS all later phases.
- **Phase 2 (image identity/reference/pixel follow-ups)**: Depends on Phase 1. Ships first among behavioral phases per spec Section 14.
- **Phase 3 (minimal-context request routing)**: Depends on Phase 2 (routing gating builds on the image-aware resolution wired there).
- **Phase 4 (model-aware token budgeting)**: Depends on Phase 3 (needs classification-gated selection in place before its budget can be meaningfully measured/evicted).
- **Phase 5 (generation/repetition improvements)**: Depends on Phase 4.
- **Phase 6 (same-chat semantic/hybrid retrieval, ⛔ gated)**: Depends on Phase 5.
- **Phase 7 (cross-chat)**: Depends on Phases 1–6 being stable (spec Section 14: "built only once Phases 1–6 are stable"); requires Phase 6's `HybridRetriever` fusion code to exist (even while gated), since cross-chat scope wraps the same function.
- **Phase 8 (grounding)**: Depends on Phases 1–7 being stable.
- **Phase 9 (final manual device validation)**: Depends on all implemented phases.

### User Story Dependencies

Unlike a typical spec where stories are independent from a foundational phase onward, this feature has an **authored, non-negotiable phase order** (spec Section 14): US4/US5/US6/US7 (image) → US1/US2/US3/US8 (routing) → token budgeting → US10 (generation) → US3 continued (retrieval fusion) → US9 (cross-chat) → US10 continued (grounding). Stories are still independently testable at their own checkpoint (each phase has its own Independent Test), but they are **not** independently sequenced — do not start a later phase's story before its prerequisite phase's checkpoint passes.

### Within Each Phase

- Tests MUST be written and FAIL before implementation, for the five phases that have required tests (Constitution VI, spec Section 12). Phase 5 and Phase 8 do not have a required-tests subsection by design.
- Diagnostics/type extensions before behavioral wiring (Phase 1 pattern, reused at each phase where a diagnostics field goes from placeholder to real).
- Story complete (checkpoint passes) before moving to the next phase.

### Parallel Opportunities

- All Setup tasks (T001–T003) run in parallel.
- Within Phase 1, T004/T005/T008 run in parallel; T006 depends on T005, T007 depends on T004+T006.
- Within each phase's Tests subsection, all `[P]`-marked tests run in parallel (different files).
- T009/T010/T011 (Phase 2 tests) run in parallel; implementation tasks T012→T013→T014→T015→T016→T017 are sequential (same file, layered wiring).
- T018/T019/T020 (Phase 3 tests) run in parallel; T021→T022→T023 are sequential (same orchestrator file).
- T024–T028 (Phase 4 tests) run in parallel; T029–T033 are largely sequential (same files/shared constant), though T032 (buckets) and T033 (recalibration) can overlap once T029/T031 land.
- T035 and T036 automated implementation are complete; T036's native acceptance remains dependent on the still-open physical-device T034, and T037 depends on the implemented T036 path.
- T042/T043 (Phase 7 tests) run in parallel; T044/T045 run in parallel, T046 depends on both, T047/T048 run in parallel after T046.

---

## Parallel Example: Phase 2 (Image Continuity)

```bash
# Tests first (must fail):
Task: "T009 pixel-dependent policy tests in tests/unit/inference/ImageEvidencePolicy.test.ts"
Task: "T010 older-image resolution tests in tests/unit/persistence/EvidenceRepository.test.ts"
Task: "T011 ambiguous-image-reference default tests in tests/unit/inference/ContextOrchestrator.test.ts"

# Then sequential wiring (same orchestrator file):
Task: "T012 wire new-image-question resolution"
Task: "T013 wire same-image-follow-up reuse"
Task: "T014 wire unambiguous older-image-reference resolution"
Task: "T015 implement ambiguous-reference default"
Task: "T016 implement use-original re-inference trigger"
```

---

## Implementation Strategy

### MVP Scope

This feature's spec explicitly mandates a phase order (Section 14) that does **not** start with the highest-priority user story alone — image continuity (US4/5/6/7) ships before minimal-context routing (US1/2/3), because the router's classification and image-decision fields need to exist and be observable (Phase 1) before either behavioral slice lands, and image continuity was ordered first among the two. The realistic MVP checkpoint is therefore **Setup + Phase 1 + Phase 2 + Phase 3** (T001–T023): at that point, independent questions get zero context, follow-ups get only what they need, long conversations stay bounded, image continuity (including ambiguous-reference safety and pixel-dependent re-inference) works end-to-end, and voice-transcribed input is confirmed (manually) to route identically — covering 8 of the 10 user stories' core behavior (US1, US2, US3, US4, US5, US6, US7, US8).

### Incremental Delivery

1. Setup + Phase 1 → classification/diagnostics observable, no behavior change.
2. Phase 2 (image) → Phase 3 (routing) → **MVP checkpoint**, validate against `quickstart.md` Phases 1–3.
3. Phase 4 (token budgeting) → validate MV-016.
4. Phase 5 (generation/repetition) → validate MV-011 manually.
5. Phase 6 (retrieval fusion, gated) → ships inert until the embedding manifest is approved.
6. Phase 7 (cross-chat) → validate MV-014, only after Phases 1–6 are confirmed stable in production use.
7. Phase 8 (grounding) → validate `quickstart.md` Phase 8, only after Phases 1–7 are confirmed stable.
8. Phase 9 → full manual validation matrix, airplane-mode check, and regression pass.

---

## Notes

- Write one focused failing suite per invariant boundary, then implement — mirrors Spec 006's testing philosophy (reduced-test, not exhaustive). Pinned constants (RRF `k = 60`, `COSINE_SIMILARITY_THRESHOLD = 0.62`) are asserted inside their owning suites (T038), not in separate micro-tests.
- Do not add UI snapshot tests, nondeterministic model-output assertions, exact-wording checks, or tests for OCR/counting/visual-correctness accuracy anywhere in this feature (spec Section 12).
- Phase 5 (generation/repetition) and Phase 8 (grounding) intentionally have no "write failing tests first" subsection — they are outside the five required test areas and are validated manually/via `src/evaluation` (Phase 8's own tests, if built, are scoped separately at that time and are not part of this feature's required coverage).
- T039/T040/T041 (Phase 6) and the embedding-dependent portion of Phase 7 (T046) MUST NOT be merged as reachable/enabled production behavior until the pre-existing embedding-artifact approval lands — they ship as tested, dead code behind the existing lexical-fallback path, exactly like `EmbeddingService`/`EmbeddingBackfill` do today.
- Commit by logical phase rather than one commit per task, consistent with Spec 006 practice.
