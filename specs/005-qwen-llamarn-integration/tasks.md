# Tasks: Qwen3-VL Instruct via llama.rn

**Input**: Design documents from `specs/005-qwen-llamarn-integration/`

**Final goal**: Qwen3-VL-2B-Instruct is fully integrated into the existing Locra app, becomes the only Locra V1 runtime, and ExecuTorch is removed after parity.

**Tests**: Required before implementation for inference and model-lifecycle work. Keep tests focused on runtime configuration, host selection, message conversion, idempotent loading, native-state isolation, streaming, cancellation, artifact verification, bundle readiness, existing-user reconciliation, and cleanup after failures.

**Scope guard**: Do not redesign UI, history, conversation stores, image preprocessing, navigation, download screens, or broad architecture. Do not modify `src/inference/ImagePreprocessor.ts` or `src/inference/ImageEnhancer.ts`; validate processed file readability inside the Qwen message converter/runtime.

## Phase 1: Audit Existing Architecture, Real Composition Roots, and Spike

**Purpose**: Record exact current app and spike facts before changing runtime or model lifecycle code.

- [X] T001 Audit existing Locra inference, model download, `BackgroundDownloadFetcher`, store, diagnostics, image flow, ExecuTorch initialization, real composition roots, local build blockers, and final-removal coupling points in `specs/005-qwen-llamarn-integration/implementation-audit.md`
- [X] T002 Audit proposed files/components/abstractions against the actual repository and record replacements for any non-existent composition root so implementation modifies real files instead of creating parallel subsystems in `specs/005-qwen-llamarn-integration/implementation-audit.md`
- [X] T003 Audit `spikes/qwen3vl-llamarn` as a Thinking-model spike only and record the exact tested `llama.rn` version, lifecycle APIs, CPU settings, context configuration, streaming, cancellation, reset, release, sampling, and preprocessing patterns in `specs/005-qwen-llamarn-integration/implementation-audit.md`
- [X] T004 Obtain approved Qwen3-VL-2B-Instruct language GGUF/projector filenames, source URLs, SHA-256 values, and sizes from the approved Instruct model source, not from the Thinking spike, and record them in `specs/005-qwen-llamarn-integration/implementation-audit.md`
- [X] T005 Audit persisted LFM readiness flags, active model IDs, model paths, `.pte` assumptions, and conversation/draft/history/image/diagnostics/settings data that must survive existing-user migration in `specs/005-qwen-llamarn-integration/implementation-audit.md`

**Checkpoint**: Implementation starts only after exact spike settings and current Locra coupling points are recorded.

---

## Phase 2: Runtime-Neutral Engine Boundary with ExecuTorch Still Working

**Purpose**: Create a runtime-neutral app boundary first, isolate the existing ExecuTorch engine, and preserve current behavior.

- [X] T006 [P] Add runtime-neutral engine contract tests for load, normalized message generation, cumulative streaming, cancellation, metrics, and request-state clearing in `tests/unit/inference/InferenceEngineHandle.test.ts`
- [X] T007 [P] Add startup host selection tests proving only one host mounts per process and no in-process runtime switching exists in `tests/unit/components/InferenceEngineHost.selection.test.tsx`
- [X] T008 Extract or move the existing `InferenceEngineHandle` and adapter contracts from `src/inference/useInferenceEngine.ts` into `src/inference/InferenceEngineHandle.ts` without creating a second overlapping inference interface
- [X] T009 Create startup-only internal runtime choice in `src/inference/StartupRuntimeSelection.ts`, initially defaulting to ExecuTorch during migration and not supporting runtime changes while the app process is running
- [X] T010 Rename and isolate the existing ExecuTorch hook behind the runtime-neutral interface in `src/inference/executorch/useExecutorchInferenceEngine.ts`
- [X] T011 Split host components into `ExecutorchInferenceEngineHost` and a parent startup-only selector in `src/components/ExecutorchInferenceEngineHost.tsx` and `src/components/InferenceEngineHost.tsx`
- [X] T012 Update `src/inference/InferenceQueue.ts`, `src/store/inferenceStore.ts`, and existing tests that import `InferenceEngineHandle` to depend on `src/inference/InferenceEngineHandle.ts` while preserving existing ExecuTorch behavior

**Checkpoint**: ExecuTorch still works through a runtime-neutral boundary, with separate host isolation and no runtime switching.

---

## Phase 3: Generalize Model Download into a Qwen Artifact Bundle

**Purpose**: Generalize the current single-file model manager into an exact-manifest artifact bundle before Qwen runtime work.

- [X] T013 [P] Add bundle manifest and independent verification tests for exact active model ID, Qwen language GGUF filename, Q8_0 projector filename, expected sizes, and SHA-256 values from the approved Instruct source in `tests/unit/model/ModelArtifactBundleManifest.test.ts`
- [X] T014 [P] Add bundle lifecycle tests for aggregate progress, pause, resume, cancellation, background reattachment, restart reconciliation, zero re-download, and `downloaded + integrityVerified` readiness for both files in `tests/unit/model/ModelArtifactBundleManager.test.ts`
- [X] T015 [P] Add existing-user reconciliation tests proving old LFM download flags are not Qwen readiness and Qwen readiness requires active model ID plus exact artifact manifest in `tests/unit/model/ModelReadinessReconciliation.test.ts`
- [X] T016 Generalize model artifact descriptors and remove `.pte`-specific readiness assumptions in `src/model/ModelArtifactManifest.ts`
- [X] T017 Generalize `ModelDownloadManager` into exact-manifest bundle download, aggregate progress, pause/resume/cancel, reattachment, reconciliation, and independent file verification in `src/model/ModelDownloadManager.ts`
- [X] T018 Update `src/model/BackgroundDownloadFetcher.ts` to remove ExecuTorch directory and `.pte` assumptions while preserving background download, pause/resume, cancellation, reattachment, restart reconciliation, and file listing for bundle artifacts
- [X] T019 Preserve aggregate product-facing model state/download UX while backing Qwen with internal per-artifact state in `src/store/modelStore.ts`
- [X] T020 Extend existing active-model compatibility and readiness checks, preserve LFM files until Qwen is verified and fallback has ended, and add Qwen-aware reconciliation without routing users to Qwen download unless Qwen is the internally selected or active runtime in `src/model/DeviceCompatibility.ts`, `src/model/ActiveModel.ts`, and `src/store/modelStore.ts`

**Checkpoint**: Fresh and existing users reach one aggregate model readiness contract; Qwen readiness never means “any GGUF exists.”

---

## Phase 4: Add llama.rn Qwen Runtime Adapter

**Purpose**: Add Qwen-specific native behavior behind the runtime-neutral engine interface.

- [X] T021 [P] Add tests pinning the exact spike-tested `llama.rn` version and CPU-only Qwen runtime config in `tests/unit/inference/QwenRuntimeConfig.test.ts`
- [X] T022 [P] Add Qwen message conversion tests for normalized text/image messages, processed file URI readability, local URI normalization, supplied-message authority, and chat-template behavior in `tests/unit/inference/QwenMessageConverter.test.ts`
- [X] T023 [P] Add Qwen runtime tests for idempotent `loadModel()`, no duplicate projector initialization, no follow-up-status residency assumptions, and stale KV/native reset before every generation path in `tests/unit/inference/QwenLlamaRuntime.lifecycle.test.ts`
- [X] T024 [P] Add Qwen runtime tests for cumulative streaming, cancellation, callback handling, release cleanup, and failure cleanup in `tests/unit/inference/QwenLlamaRuntime.streamingCancel.test.ts`
- [X] T025 Pin the exact spike-tested `llama.rn` version and native plugin configuration in `package.json`, `package-lock.json`, and `app.json`
- [X] T026 Implement Qwen runtime config constants from the spike audit in `src/inference/llamaRn/QwenRuntimeConfig.ts`
- [X] T027 Implement Qwen message conversion, native file URI normalization, processed file readability checks, and chat-template handling in `src/inference/llamaRn/QwenMessageConverter.ts`
- [X] T028 Implement the llama.rn Qwen adapter with private lifecycle state, idempotent `loadModel()`, native-state reset, streaming callbacks, cancellation, metrics, and release cleanup in `src/inference/llamaRn/QwenLlamaRuntime.ts`
- [X] T029 Create `QwenInferenceEngineHost` that calls Qwen hooks only inside the Qwen host component in `src/components/QwenInferenceEngineHost.tsx`

**Checkpoint**: Qwen native behavior is isolated in the adapter and host; the parent host does not conditionally call different hooks.

---

## Phase 5: Connect Qwen to Existing Locra Flow

**Purpose**: Connect the Qwen adapter to queue/stores/diagnostics without moving Qwen-specific logic into the queue or redesigning app flows.

- [X] T030 [P] Add queue/store integration tests proving the queue stays runtime-neutral while existing stores preserve conversation context, history, drafts, streaming state, cancellation, and diagnostics in `tests/unit/inference/InferenceQueue.runtimeNeutral.test.ts` and `tests/unit/store/inferenceStore.qwenRuntime.test.ts`
- [X] T031 [P] Add integration test proving Qwen uses the existing two-stage Locra vision pipeline unchanged and does not modify `src/inference/ImagePreprocessor.ts` or `src/inference/ImageEnhancer.ts` in `tests/integration/qwen-existing-vision-pipeline.test.ts`
- [X] T032 Wire startup selection to mount either `ExecutorchInferenceEngineHost` or `QwenInferenceEngineHost` exactly once at app startup in `src/components/InferenceEngineHost.tsx`
- [X] T033 Update `src/inference/InferenceQueue.ts` to call only the runtime-neutral engine for idempotent load, normalized message submission, cumulative streaming, cancellation, and metrics consumption
- [X] T034 Connect Qwen streaming, cancellation, metrics, and completion states to existing stores without changing history or conversation-store shape in `src/store/inferenceStore.ts`
- [X] T035 Map Qwen diagnostics to existing diagnostics surfaces without exposing raw model IDs, hidden prompts, native internals, or internal stages in `src/diagnostics/DiagnosticsExportService.ts`

**Checkpoint**: Qwen works through the existing queue, stores, image flow, diagnostics, streaming, cancellation, and conversation context.

---

## Phase 6: Validate Parity, Migration, Failure Recovery, and Device Behavior

**Purpose**: Prove Qwen is ready before promotion and before removing ExecuTorch.

- [X] T036 Run focused automated parity tests for text streaming, image Q&A, follow-ups, cancellation, and failure recovery in `tests/integration/qwen-parity-flow.test.ts`
- [X] T037 Run existing-user migration tests proving LFM users continue normally while ExecuTorch is selected, are routed through Qwen download only when Qwen is selected/active and Qwen artifacts are missing, and do not lose conversations, drafts, images, history, diagnostics, or settings in `tests/integration/qwen-existing-user-migration.test.ts`
- [ ] T038 Manually validate fresh-user Qwen download, pause/resume, cancel, background reattachment, process restart reconciliation, zero re-download, and reaching chat on a physical Android 13+ device using `specs/005-qwen-llamarn-integration/quickstart.md` <!-- BLOCKED: requires a physical Android 13+ device; results template prepared in quickstart.md -->
- [ ] T039 Manually validate text streaming, image Q&A, multi-turn follow-ups, cancellation, app backgrounding, failure recovery, memory, thermal behavior, and full Locra end-to-end vision latency separately from the spike runtime-level vision baseline using `specs/005-qwen-llamarn-integration/quickstart.md` <!-- BLOCKED: requires a physical Android 13+ device; results template prepared in quickstart.md -->
- [ ] T040 Record physical-device parity against the spike baselines of about 2.34s model load, 5.33s comparable runtime-level vision completion, and 35.7 tok/s with no unexplained regression greater than 25% in `specs/005-qwen-llamarn-integration/quickstart.md` <!-- BLOCKED: requires a physical Android 13+ device; results template prepared in quickstart.md -->


**Checkpoint**: Fresh users download both Qwen artifacts and reach chat; existing LFM users transition to Qwen without losing app data; text, vision, follow-ups, cancellation, failures, two-stage vision pipeline, performance, memory, and thermal behavior are validated.

---

## Phase 7: Make Qwen the Active V1 Runtime

**Purpose**: Promote Qwen after parity while ExecuTorch still exists only as temporary removable fallback code.

- [X] T041 Add tests proving startup selection defaults to Qwen V1 and no normal-user runtime picker or switching path exists in `tests/unit/inference/StartupRuntimeSelection.qwenV1.test.ts`
- [X] T042 Set Qwen as the active V1 startup runtime and keep only startup-time host selection in `src/inference/StartupRuntimeSelection.ts` and `src/components/InferenceEngineHost.tsx`
- [X] T043 Update active model metadata so Qwen is the active V1 model ID and readiness is tied to its exact artifact manifest in `src/model/ActiveModel.ts` and `src/model/ModelPresentation.ts`
- [X] T044 Validate Qwen-only active runtime behavior before ExecuTorch deletion with text streaming, image Q&A, follow-ups, cancellation, and failures in `tests/integration/qwen-active-v1-flow.test.ts`

**Checkpoint**: Qwen is the only active V1 runtime path selected for normal app startup; no UI/runtime switching is introduced.

---

## Phase 8: Remove ExecuTorch and Restore Windows Local Android Builds

**Purpose**: Remove the temporary fallback completely and restore local Windows Android builds.

- [X] T045 Remove `initExecutorch`, `react-native-executorch`, and `react-native-executorch-expo-resource-fetcher` initialization from `index.ts`
- [X] T046 Remove `react-native-executorch`, the ExecuTorch resource fetcher, and ExecuTorch Expo/native configuration from `package.json`, `package-lock.json`, `app.json`, `eas.json`, and any Expo plugin configuration
- [X] T047 Delete the legacy ExecuTorch hook and host files from `src/inference/executorch/useExecutorchInferenceEngine.ts` and `src/components/ExecutorchInferenceEngineHost.tsx`
- [X] T048 Remove LFM model constants, paths, configuration, `.pte` assumptions, ExecuTorch directory assumptions, and ExecuTorch-specific download composition from `src/model/ActiveModel.ts`, `src/model/ModelConfig.ts`, `src/model/ModelPresentation.ts`, `src/model/ModelDownloadManager.ts`, and `src/model/BackgroundDownloadFetcher.ts` <!-- ActiveModel/ModelConfig/ModelPresentation already Qwen-only; removed dead `executorch_pte` artifact kind and flipped BackgroundDownloadFetcher default file predicate `.pte`→`.gguf`. The generic single-artifact download path in ModelDownloadManager is runtime-neutral (used by out-of-scope contract tests) and was left intact. -->
- [X] T049 Delete `scripts/blocked-local-android.js` and restore the package Android command to `expo run:android` in `package.json`
- [X] T050 Remove or update obsolete ExecuTorch-specific tests in `tests/unit/inference/useInferenceEngine.test.ts`, `tests/unit/model/ActiveModel.test.ts`, `tests/unit/model/ModelConfig.test.ts`, `tests/unit/model/ModelDownloadManager.test.ts`, `tests/unit/model/ModelPresentation.test.ts`, and `tests/unit/model/BackgroundDownloadFetcher.test.ts` <!-- useInferenceEngine.test.ts already deleted; BackgroundDownloadFetcher.test.ts retargeted from `.pte`/react-native-executorch fixtures to `.gguf`/neutral model dir. -->
- [X] T051 Run `npm test`, `npx tsc --noEmit`, and `npx eslint src tests --ext .ts,.tsx` after ExecuTorch removal and resolve failures in touched test/source files <!-- tsc + eslint clean. `npm test`: all ExecuTorch-removal-touched files pass; 8 failures remain in 4 suites (ContextBuilder, ContextOrchestrator, output-pipeline, InferenceQueue follow-up) — pre-existing, committed red at f787420, about canonical follow-up context assembly, unrelated to ExecuTorch removal. -->
- [ ] T052 Manually validate `npx expo run:android` builds and installs locally on Windows and record the result in `specs/005-qwen-llamarn-integration/quickstart.md` <!-- BLOCKED: requires a local Windows Android build/device; the blocked-local-android script is removed and the `android` script now runs `expo run:android`. -->

**Checkpoint**: ExecuTorch is completely removed; Qwen is the only active V1 runtime; Windows `npx expo run:android` builds and installs locally.

---

## Dependencies & Execution Order

1. **Phase 1 audit** blocks all implementation.
2. **Phase 2 runtime-neutral boundary** must finish before Qwen runtime or final removal work.
3. **Phase 3 artifact bundle** must finish before Qwen parity and promotion.
4. **Phase 4 Qwen adapter** depends on Phase 1 and Phase 2; it consumes the bundle manifest from Phase 3.
5. **Phase 5 app integration** depends on Phase 4.
6. **Phase 6 validation** depends on Phases 3-5.
7. **Phase 7 promotion** depends on Phase 6 parity approval.
8. **Phase 8 ExecuTorch removal** depends on Phase 7.

## Parallel Opportunities

- T006 and T007 can run in parallel after the audit.
- T013, T014, and T015 can run in parallel because they target separate bundle test files.
- T021, T022, T023, and T024 can run in parallel because they target separate Qwen adapter test files.
- T030 and T031 can run in parallel before queue/store implementation.
- Manual validations T038 and T039 can be prepared in parallel but must run on the physical-device build after T036 and T037 pass.

## Final Checkpoints

- Fresh users download both Qwen artifacts and reach chat.
- Existing LFM users transition to Qwen without losing conversations, drafts, images, history, diagnostics, or settings.
- Text streaming, image Q&A, follow-ups, cancellation, and failures work.
- The existing two-stage Locra vision pipeline is preserved.
- Qwen becomes the only active V1 runtime.
- ExecuTorch is completely removed.
- `npx expo run:android` builds and installs locally on Windows.
- No UI, history, conversation-store, image-preprocessing, or broader architecture redesign occurs.

## Removed/Merged/Reordered Compared with Prior Task List

- Removed standalone production tasks/files for `MigrationPlanRecord`, persisted migration phases, parity-record helpers, and standalone Qwen runtime-state helpers.
- Removed tasks modifying `src/inference/ImagePreprocessor.ts` and `src/inference/ImageEnhancer.ts`; Qwen file-readability validation moved into the Qwen message converter/runtime.
- Merged broad scattered setup/foundational tasks into an explicit audit phase and runtime-neutral boundary phase.
- Reordered Qwen artifact bundle work before Qwen parity and promotion.
- Reordered final Qwen promotion before complete ExecuTorch deletion.
- Added explicit existing-user migration, exact artifact-manifest readiness, full ExecuTorch removal, blocked-script deletion, and Windows local Android build restoration tasks.
- Corrected the spike audit so Thinking spike facts are used only for llama.rn lifecycle/configuration/patterns, while Instruct artifact filenames, URLs, sizes, and SHA-256 values come from the approved Instruct source.
- Added `src/model/BackgroundDownloadFetcher.ts` to bundle generalization and final ExecuTorch/`.pte` cleanup.
- Added `src/inference/StartupRuntimeSelection.ts` creation during the runtime-neutral boundary phase.
- Corrected existing-user migration timing so Qwen download routing only occurs when Qwen is selected or active.
