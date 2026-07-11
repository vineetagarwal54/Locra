---
description: "Task list for Feature 004 — Model Bake-off (LFM vs Gemma)"
---

# Tasks: Model Bake-off (LFM vs Gemma)

**Input**: Design documents from `/specs/004-model-bake-off/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/model-selection.contract.md, quickstart.md

**Tests**: INCLUDED and deliberately minimal — limited to (1) model selection, (2) model-specific lifecycle/source/integrity isolation, (3) evaluation metadata, and (4) comparison model attribution. These are model-lifecycle/inference code, so the relevant tests are written first (TDD, Constitution Principle VI). Inference-engine routing is asserted by extending the existing `useInferenceEngine` test, not a new standalone suite. No broad model-behavior, output-quality, or UI tests are added.

**Organization**: Grouped by user story (US1 P1, US2 P2, US3 P3) on top of a shared `ActiveModel` foundation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (setup, foundational, and polish tasks carry no story label)
- Paths are repo-relative (single React Native app under `src/`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Document the selector. No fabricated model metadata is created here.

- [X] T001 [P] Document the `EXPO_PUBLIC_LOCRA_VLM` build-time selector (values `lfm2_5_vl_1_6b` | `gemma4_e2b`; missing ⇒ LFM; any other non-empty value ⇒ error) in `README.md` (or a dev-notes doc) and add an `.env.example` entry `EXPO_PUBLIC_LOCRA_VLM=lfm2_5_vl_1_6b`. Do NOT create `model-configs/gemma-4-e2b-multimodal.json` yet — it is created only after the real Gemma values are captured (T008).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The single `ActiveModel` selection seam every user story imports.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Write failing unit test `tests/unit/model/ActiveModel.test.ts` for `resolveActiveModel` (contract C1, corrected behavior): unset/undefined ⇒ LFM; `'lfm2_5_vl_1_6b'` ⇒ LFM; `'gemma4_e2b'` ⇒ Gemma; **any other non-empty value ⇒ throws a clear error** (no silent fallback for unrecognized values).
- [X] T003 Implement `src/model/ActiveModel.ts`: define the `ModelCandidate` type and the two registry entries and `resolveActiveModel(raw = process.env.EXPO_PUBLIC_LOCRA_VLM)` + the resolved `activeModel` singleton, with the T002 behavior (unrecognized non-empty ⇒ throw). The **LFM** descriptor is fully populated with its existing real integrity fallback (sha256/size). The **Gemma** descriptor carries `id:'GEMMA4_E2B_MM'`, `modelConstant: GEMMA4_E2B_MM`, `modelName:'gemma4-e2b-multimodal'`, `generationConfigId:'gemma4-e2b-mm-library-default'`, and `integrityConfigEndpoint`, but its integrity fallback sha256/size are left **unpopulated/pending** and pinned in T008 after capture — do NOT invent placeholder values. Make T002 pass. (FR-001, FR-002)

**Checkpoint**: `activeModel` resolves correctly (and rejects garbage); user stories can proceed.

---

## Phase 3: User Story 1 - Build Locra with either model, LFM stays default (Priority: P1) 🎯 MVP

**Goal**: The build-selected model powers the entire app end to end; a build with no selection runs LFM exactly as today.

**Independent Test**: Build with no selection ⇒ LFM loads/answers; build with `EXPO_PUBLIC_LOCRA_VLM=gemma4_e2b` ⇒ Gemma loads/answers on the device (quickstart.md); the extended host test confirms routing.

- [X] T004 [US1] Extend the existing `tests/unit/inference/useInferenceEngine.test.ts` (fold the routing assertion into it — do NOT add a standalone suite) to fail first: assert `useLLM` is invoked with `activeModel.modelConstant` (mock `../model/ActiveModel`; verify the LFM constant by default and the Gemma constant when the resolver returns Gemma).
- [X] T005 [US1] Route `src/inference/useInferenceEngine.ts` to `useLLM({ model: activeModel.modelConstant })`, replacing the hardcoded `LFM2_5_VL_1_6B_QUANTIZED`, keeping this the single `useLLM` call site (FR-004). Do NOT add a `configure({ generationConfig })` call — each model's bundled config is auto-applied at load (research R2, FR-006). Make T004 pass.
- [X] T006 [P] [US1] In `eas.json`, add a `gemma` build profile that **only** sets `EXPO_PUBLIC_LOCRA_VLM=gemma4_e2b`, keeps the exact same `android.package` / application ID and the same app storage namespace as the default/LFM profile, and does **not** create a side-by-side app variant; the default profile leaves `EXPO_PUBLIC_LOCRA_VLM` unset (⇒ LFM). (FR-015, SC-001)

**Checkpoint**: A Gemma build and the default LFM build each load and answer end to end under one application ID.

---

## Phase 4: User Story 2 - Correct, isolated model lifecycle per build (Priority: P2)

**Goal**: Download, integrity verification, readiness reconciliation, storage checks, pause/resume/cancel, and background download operate on the selected model; an on-disk LFM is never mistaken for Gemma or vice versa. `ModelDownloadManager` stays dependency-injected — the composition root (`modelStore`) owns active-model filename derivation.

**Independent Test**: On a device holding a verified LFM model, a Gemma build reports not-ready and downloads Gemma without deleting LFM; reinstalling the LFM build reports ready immediately with no re-download (quickstart.md); the extended lifecycle tests prove source routing, integrity selection, and filename-scoped reconciliation.

- [X] T007 [US2] Capture the real Android Gemma Vulkan `.pte` SHA-256 and byte size (download the artifact referenced by `GEMMA4_E2B_VULKAN_MM` once; compute SHA-256 + size). Record the exact values for T008 (research R5).
  - Captured from the complete Android Vulkan artifact stream: SHA-256 `56c6137e47ae5b64174259deb5d96a5d18bb86f2d992cfd96b65d869889b3fd2`; size `4,371,419,520` bytes.
- [X] T008 [US2] Using ONLY the real values from T007, create `model-configs/gemma-4-e2b-multimodal.json` (real `sha256` + `size`) and pin the Gemma integrity fallback (sha256/size) into the Gemma descriptor in `src/model/ActiveModel.ts`. No fabricated values.
- [X] T009 [US2] Extend the existing model/lifecycle unit tests (`tests/unit/model/ModelDownloadManager.*.test.ts` and `tests/unit/model/ModelConfig.test.ts`) to FAIL first for all three, keeping additions minimal: (a) **selected-model source routing** — the manager receives the active model's sources; (b) **selected-model integrity endpoint/fallback** — `ModelConfig` resolves the active model's own endpoint and fallback SHA-256 + size (Gemma's, distinct from LFM's); (c) **model-specific reconciliation** — `reconcile()`/readiness use an injected expected `.pte` filename so only the *other* model's `.pte` on disk ⇒ not-ready, and the active model's own `.pte` present (size ≥ expected) ⇒ ready with no re-download; both present ⇒ ready for the active model only, never deleting the other.
- [X] T010 [US2] Implement `reconcile()`/readiness in `src/model/ModelDownloadManager.ts` to filter `fetcher.listDownloadedModels()` by an **injected expected `.pte` filename** (a new dependency-injected field) before the size check. `ModelDownloadManager` MUST remain dependency-injected and MUST NOT import `activeModel` or `ResourceFetcherUtils`. Makes the reconciliation part of T009 pass. (FR-008)
- [X] T011 [US2] In `src/store/modelStore.ts` (the composition root), set `MODEL_SOURCES` and the model-config endpoint from `activeModel`, and derive the expected `.pte` filename via `ResourceFetcherUtils.getFilenameFromUri(activeModel.modelConstant.modelSource)` and inject it into `ModelDownloadManager` (single owner of filename derivation). Pause/resume/cancel/background already act on `this.deps.sources`, so they follow automatically. Makes the source-routing part of T009 pass. (FR-007)
- [X] T012 [US2] Make integrity config model-specific in `src/model/ModelConfig.ts`: resolve the fallback (sha256/size) and endpoint from `activeModel`, replacing the single hardcoded LFM `FALLBACK_MODEL_CONFIG`; keep verifying only the model `.pte` (unchanged, FR-005). Makes the integrity part of T009 pass. (FR-009)
- [X] T013 [US2] Make model presentation and storage metadata model-specific: the display name comes from the active model descriptor; the download size and the required-storage calculation come from the active model's size (descriptor/integrity fallback), replacing the LFM-only `PINNED_MODEL_SIZE_BYTES` usage in `src/model/ModelConfig.ts` / `src/model/ModelPresentation.ts` and the storage check. Gemma MUST never display or use LFM-specific storage metadata. Production copy stays model-agnostic where it already is (Principle XI). (FR-007)

**Checkpoint**: Switching builds on one device never yields a false-ready event; both models coexist on disk under one app; sizes/names reflect the active model.

---

## Phase 5: User Story 3 - Comparable evaluation and diagnostics tagged by model (Priority: P3)

**Goal**: Every evaluation result and diagnostic export records the actual model id and generation configuration; the 18-case suite runs unchanged; the two result sets are comparable and model-attributed.

**Independent Test**: Run the 18-case eval on each build; every record carries the correct `modelId`/`generationConfigId`; `caseSetVersion` stays `cases.v1`; the comparison tool places both sets side by side with model identity, keyed by `caseId`.

- [X] T014 [US3] Extend the existing tests to FAIL first (minimal additions): in `tests/unit/inference/InferenceQueue.test.ts`, assert `buildObjectiveResult` records `modelId === activeModel.id` and `generationConfigId === activeModel.generationConfigId` (default LFM build still records the unchanged literal `'LFM2_5_VL_1_6B_QUANTIZED'`); in `tests/unit/evaluation/QualityEvalCompare.test.ts`, assert the comparison output preserves `caseId`-based comparison **and** carries model identity for each side (contract C4/C5, FR-016).
- [X] T015 [US3] In `src/inference/InferenceQueue.ts` `buildObjectiveResult()`, source `modelId` from `activeModel.id` and `generationConfigId` from `activeModel.generationConfigId` directly (remove the hardcoded literal and `CURRENT_GENERATION_CONFIG_ID`); leave `pipelineVariantId`, timings, tokens, and the `buildAnswerPrompt` inputs unchanged (prompts held constant — verified: `buildAnswerPrompt` ignores the id). Makes the metadata part of T014 pass. (FR-010)
- [X] T016 [US3] Update `src/diagnostics/DiagnosticsExportService.ts` `resolveAppDiagnosticsInfo` so `modelId` and `generationConfigId` come from the most recent objective result when available, and use `activeModel` values only as the fallback. Do NOT add any new diagnostics fields. (FR-010)
- [X] T017 [US3] Extend the quality-eval comparison tooling `src/evaluation/QualityEvalCompare.ts` to add model identity to the comparison output while preserving the existing `caseId`-based comparison. Do NOT create a new report, UI, dashboard, or comparison system. Makes the comparison part of T014 pass. (FR-016)
- [X] T018 [US3] Verify `src/evaluation/recorder/EvaluationRecorder.ts` passes `objective.modelId`/`generationConfigId` through unchanged and that `caseSetVersion` stays `'cases.v1'` for both models (no schema change); add an assertion to the existing evaluation recorder test if not already covered. (FR-011/FR-012)

**Checkpoint**: Two runs' exported records differ only by model identity + metrics and compare cleanly by `caseId`.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Regression safety and end-to-end device validation (including FR-014).

- [X] T019 [P] Run `npm run type-check` and `npm run lint`; resolve any issues from the model-selection routing.
- [ ] T020 Run `npm test`; confirm the full existing suite still passes (default build = LFM regression, SC-005) alongside the new selection (T002), lifecycle-isolation (T009), and metadata/comparison (T014) tests.
- [ ] T021 Execute the `quickstart.md` device validation on the physical bake-off device: build LFM + Gemma, run the isolation flow, run the 18-case eval on each, and compare. For FR-014 specifically: verify Gemma **successfully loads and runs**, confirm **Vulkan compatibility and the absence of native crashes**, and confirm that a Gemma model-load failure which surfaces through the existing runtime error path reaches the existing `errored` UI state (not a broken/stuck state). Do NOT add a new Vulkan detection subsystem (research R1).
- [ ] T022 [P] Add bake-off run instructions to `README.md` (or dev notes) linking `specs/004-model-bake-off/quickstart.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; **blocks all user stories** (every consumer imports `activeModel`).
- **US1 / US2 / US3 (Phases 3–5)**: each depends only on Foundational. US3's *device* comparison naturally uses US1+US2 builds; its code tasks are independent.
- **Polish (Phase 6)**: depends on the targeted user stories.

### Within Each Story (test-first, Principle VI)

- Foundational: T002 (fails) → T003.
- US1: T004 (fails) → T005 → T006.
- US2: T007 → T008 (real Gemma data pinned) → T009 (fails for source routing, integrity selection, reconciliation) → T010 → T011 → T012 → T013.
- US3: T014 (fails for metadata + comparison) → T015 → T016 → T017 → T018.

### Parallel Opportunities

- Setup/foundational: none needed (single-threaded seam).
- US1: T006 [P] runs alongside T004/T005 (different file, `eas.json`).
- US2: after the T009 test lands, T010 (manager) / T011 (modelStore) / T012 (ModelConfig) / T013 (presentation) touch different files, but T010+T011 together satisfy reconciliation, so implement T010→T011 before asserting that part; T012 and T013 can proceed in parallel with them (different files).
- US3: after T014→T015, T016 (diagnostics) and T017 (comparison) touch different files and can run in parallel.
- Polish: T019 and T022 in parallel; T020/T021 after code is complete.

---

## Parallel Example: User Story 3

```bash
# After T014→T015 land, run in parallel:
Task: "T016 objectiveResult-first modelId/generationConfigId in src/diagnostics/DiagnosticsExportService.ts"
Task: "T017 add model identity to caseId comparison in src/evaluation/QualityEvalCompare.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (`ActiveModel` seam, with strict unrecognized-value error).
2. Phase 3 US1: route `useLLM` through `activeModel` + add the same-app-ID `gemma` build profile.
3. **STOP and VALIDATE**: build LFM (default) and Gemma; each loads and answers on-device.

### Incremental Delivery

1. Foundation ready → US1 (two working builds, MVP) → US2 (trustworthy per-model lifecycle, real Gemma integrity data) → US3 (comparable, model-tagged results).
2. Each story preserves the default LFM behavior (SC-005, guarded by T020).

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- One seam (`src/model/ActiveModel.ts`); `ModelDownloadManager` stays DI (no `activeModel`/`ResourceFetcherUtils` import) — `modelStore` derives and injects the expected `.pte` filename.
- No fabricated Gemma sha256/size anywhere; `model-configs/gemma-4-e2b-multimodal.json` and the Gemma integrity fallback are created only from the real captured values (T007→T008).
- Diagnostics prefer the objective result's recorded values; `activeModel` is only the fallback. No new diagnostics fields.
- Do NOT add model-specific prompt/generation tuning (FR-006) — Gemma uses the library default automatically.
- Gemma's real sha256/size (T007→T008) gate only release-mode integrity verification; dev bring-up uses the `__DEV__` skip.
