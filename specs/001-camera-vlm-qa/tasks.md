---

description: "Task list for Camera Vision Q&A (Phase 1)"
---

# Tasks: Camera Vision Q&A (Phase 1)

**Input**: Design documents from `/specs/001-camera-vlm-qa/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Included. Constitution Principle VI makes TDD NON-NEGOTIABLE for every
function in the inference pipeline and model lifecycle modules (InferenceQueue,
InferenceMetrics, ImagePreprocessor, DeviceCompatibility, ModelDownloadManager,
ModelIntegrity) — their test tasks are mandatory, not optional, and are ordered
strictly before their implementation tasks per this feature's stated ordering
constraints. The HistoryStore contract test is included too (good practice, not
constitution-mandated) since `contracts/history-store.contract.md` already
specifies its pre/postconditions.

**Organization**: Tasks are grouped by user story (spec.md priorities P1–P5) so
each story is independently implementable and testable, per the confirmed plan
decisions: RN 0.81+, Android API 33 minimum, `LFM2_5_VL_1_6B_QUANTIZED`,
`useInferenceEngine.ts` as the sole `useLLM` call site, `DeviceCompatibility.ts`
in `model/` not `inference/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps task to a user story (US1–US5) for traceability
- Every task names its exact file path and is scoped to one implement→test→commit session

## Path Conventions

Single React Native project (no backend) per `plan.md`'s Project Structure:
`src/{screens,inference,model,store,history,components}/`, `tests/{unit,contract,integration}/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Get a bootable Expo Dev Client app with the New Architecture and all
Phase 1 dependencies installed, before any feature code is written.

- [X] T001 Initialize the Expo Dev Client React Native project pinned to RN 0.81–0.85 (confirmed decision — not 0.76) with the New Architecture enabled (`newArchEnabled` in `app.json`/`gradle.properties`), per constitution Principle VII and `plan.md` Technical Context
- [X] T002 [P] Configure TypeScript strict mode repo-wide in `tsconfig.json` (`"strict": true`, no `any` allowed) per constitution Principle V
- [X] T003 [P] Configure ESLint/Prettier for the project in `.eslintrc.js` / `.prettierrc`
- [X] T004 Install Phase 1 dependencies in `package.json`: `react-native-executorch`, `react-native-executorch-expo-resource-fetcher`, `expo-file-system`, `expo-asset`, `react-native-vision-camera`, `react-native-mmkv`, `zustand`, `@react-navigation/native` (+ native-stack), `react-native-reanimated`, `react-native-device-info`, `expo-crypto` — versions matching the RN 0.81–0.85 / Expo SDK band verified in `research.md` at install time
- [X] T005 Call `initExecutorch({ resourceFetcher: ExpoResourceFetcher })` exactly once at app entry, before any screen mounts, in `App.tsx` (or `index.ts`) — per `research.md`'s "Initialization sequence" decision; without this every `useLLM` call throws
- [X] T006 [P] Set up the React Navigation native-stack with five placeholder route components (`CaptureScreen`, `AnswerScreen`, `HistoryScreen`, `ModelSetupScreen`, `BenchmarkScreen`) in `src/screens/*.tsx` and `src/navigation/AppNavigator.tsx` — stub content only, no logic yet, so later tasks fill in real screens in place

**Checkpoint**: App builds and runs on a physical Android device, navigates between five empty screens, `initExecutorch` succeeds at startup.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, the single MMKV store, and the device compatibility
gate — the one piece every later phase depends on per the explicit ordering
constraint "DeviceCompatibility check must be implemented before any task that
touches model loading."

**⚠️ CRITICAL**: No user story work may begin until this phase is complete.

- [X] T007 [P] Define shared TypeScript types (`QASession`, `PerformanceMetrics`, `OnDeviceModel`, `DeviceCompatibilityResult`, `InferenceState`, `InferenceRequest`, `ModelState`) in `src/types/models.ts`, matching `data-model.md` field-for-field
- [X] T008 [P] Create the single MMKV storage instance in `src/storage/mmkv.ts` — the only file in the project permitted to import `react-native-mmkv` directly (constitution Principle VIII: no AsyncStorage, no SQLite)
- [X] T009 [P] Write unit tests for device compatibility evaluation in `tests/unit/model/DeviceCompatibility.test.ts`, covering: sufficient RAM + Android 13+ → `isSupported: true`; insufficient RAM → `isSupported: false` with a non-null `reason`; OS below API 33 → `isSupported: false` with a non-null `reason`; a thrown device-info read → `isSupported: false` with a `reason`, never a thrown error (must fail before T010 exists)
- [X] T010 Implement `checkDeviceCompatibility()` in `src/model/DeviceCompatibility.ts` using `react-native-device-info` (total RAM) and `Platform.Version` (Android API 33 minimum, confirmed decision), satisfying `contracts/model-lifecycle.contract.md` and making T009 pass

**Checkpoint**: Device compatibility gate implemented and tested. Every later phase that touches model loading depends on `T010`.

---

## Phase 3: User Story 1 - Ask a question about what the camera sees (Priority: P1) 🎯 MVP

**Goal**: Capture → type a question → submit → watch a streamed on-device answer with all five performance metrics, fully offline.

**Independent Test**: With `model/` mocked to report `isReadyForInference() === true` (no real download required yet — that's US2), capture an image, submit a question, and confirm a streamed answer with all five metrics appears while the device is in airplane mode (spec.md US1 Acceptance Scenarios 1–2).

### Tests for User Story 1 (write first — Principle VI, NON-NEGOTIABLE; must fail before implementation)

- [X] T011 [P] [US1] Unit tests for image preprocessing in `tests/unit/inference/ImagePreprocessor.test.ts`: input above 512×512 is resized down to the ceiling; input already ≤512×512 passes through unchanged; non-image input rejects with a clear error (constitution Principle IV)
- [X] T012 [P] [US1] Unit tests for metrics calculation in `tests/unit/inference/InferenceMetrics.test.ts`: model load time, preprocessing time, first-token latency, tokens/sec, and total wall time are each computed correctly from recorded timestamps/token counts, and all five are present together on a completed result (FR-008)
- [X] T013 [P] [US1] Unit tests for the single-flight queue in `tests/unit/inference/InferenceQueue.test.ts`: `submit()` while a request is in-flight rejects without acquiring the lock (FR-006); `cancel()` discards partial response and returns to `idle` with no residual output (FR-007); an injected OOM error during `'streaming'` resolves to `status: 'errored'` with a message, never an unhandled throw (FR-023); the lock is released on every one of the completed/cancelled/errored exit paths

### Implementation for User Story 1

- [X] T014 [P] [US1] Implement image preprocessing (resize/compress to the ≤512×512 hard ceiling) in `src/inference/ImagePreprocessor.ts`, satisfying T011
- [X] T015 [P] [US1] Implement metrics instrumentation in `src/inference/InferenceMetrics.ts`, satisfying T012
- [X] T016 [US1] Implement the single-flight `InferenceQueue` in `src/inference/InferenceQueue.ts` per `contracts/inference-pipeline.contract.md` — depends on T014, T015 for the preprocessing/metrics steps its state machine calls, and on T010 (`checkDeviceCompatibility`/model-readiness gate must exist before this queue is allowed to touch model loading); use a mocked `isReadyForInference() => true` for now (real wiring happens in T028 once US2 exists), satisfying T013
- [X] T017 [US1] Implement `useInferenceEngine.ts` in `src/inference/useInferenceEngine.ts` — the one sanctioned `useLLM({ model: LFM2_5_VL_1_6B_QUANTIZED })` call site (confirmed decision), adapting ExecuTorch's hook-shaped streaming state (`token`, `response`, `isGenerating`, `interrupt`) to `InferenceQueue`'s plain-function interface; depends on T016
- [X] T018 [US1] Create the `inferenceStore` (Zustand) in `src/store/inferenceStore.ts` wrapping `useInferenceEngine`/`InferenceQueue` state for screen consumption; depends on T017
- [X] T019 [US1] Implement `CaptureScreen.tsx` in `src/screens/CaptureScreen.tsx` — camera capture + prompt text input, calls `inferenceStore`'s submit action, disables the submit control while an inference is in-flight (FR-006); contains no business logic beyond calling the store. Depends on T006 and T018; per the explicit ordering constraint, `InferenceQueue` (T016) must exist before this task starts
- [X] T020 [US1] Implement `AnswerScreen.tsx` in `src/screens/AnswerScreen.tsx` — renders the streamed `response` and all five metrics from `inferenceStore`, with a cancel control wired to the queue's `cancel()`; depends on T018; per the explicit ordering constraint, `InferenceQueue` (T016) must exist before this task starts

**Checkpoint**: The core ask loop is fully functional and independently testable end-to-end (against a mocked model-readiness gate) — this is the MVP.

---

## Phase 4: User Story 2 - Get set up on a new or incompatible device (Priority: P2)

**Goal**: Unsupported devices see an explanatory setup screen instead of a crash; missing or corrupt models route to a resumable, integrity-verified download instead of a crash.

**Independent Test**: On a device profile below the compatibility threshold, and separately with the model file deleted or corrupted, confirm each routes to the correct screen state without a crash (spec.md US2 Acceptance Scenarios 1–4) — and confirm `ModelSetupScreen` renders and behaves correctly against a mocked `modelStore`, with no real network download required for the test itself (explicit ordering constraint).

### Tests for User Story 2 (write first — Principle VI, NON-NEGOTIABLE; must fail before implementation)

- [X] T021 [P] [US2] Unit tests for integrity verification in `tests/unit/model/ModelIntegrity.test.ts`: a file matching the pinned SHA-256 hash verifies true; a mismatched hash verifies false; a missing file verifies false without throwing
- [X] T022 [P] [US2] Unit tests for download lifecycle management in `tests/unit/model/ModelDownloadManager.test.ts`, against a mocked `ExpoResourceFetcher`: `startDownload()` resolves to `'downloaded'` + a true integrity check on success, or `'failed'` on a bad hash; `pauseDownload()`/`resumeDownload()` no-op safely (not throw) when there is nothing active to pause/resume; a failed integrity check deletes the corrupt local file before the module reports `'failed'` (data-model.md `OnDeviceModel` validation rules)

### Implementation for User Story 2

- [X] T023 [P] [US2] Implement SHA-256 verification in `src/model/ModelIntegrity.ts` using `expo-crypto`, satisfying T021
- [X] T024 [US2] Implement `ModelDownloadManager` in `src/model/ModelDownloadManager.ts` wrapping `ExpoResourceFetcher`'s `fetch`/`pauseFetching`/`resumeFetching`/`cancelFetching`/`deleteResources`, calling `ModelIntegrity` after every fetch resolves; depends on T023 and on T010 (device compatibility must exist first per the explicit ordering constraint, since this module touches model download/loading); satisfying T022
- [X] T025 [US2] Create the `modelStore` (Zustand) in `src/store/modelStore.ts` composing `DeviceCompatibility` (T010) and `ModelDownloadManager` (T024) into the full `ModelLifecycle` contract (`checkDeviceCompatibility`, `getState`, `subscribe`, `startDownload`, `pauseDownload`, `resumeDownload`, `cancelDownload`, `isReadyForInference`); depends on T010, T024
- [X] T026 [US2] Implement `ModelSetupScreen.tsx` in `src/screens/ModelSetupScreen.tsx` — shows the unsupported-device explanation when `checkDeviceCompatibility().isSupported` is false, otherwise download progress with pause/resume/cancel controls, routing forward once `modelStore.isReadyForInference()` is true; built and unit-tested against a mocked `modelStore` so no real downloaded model is required (explicit ordering constraint); depends on T025
- [X] T027 [US2] Replace `InferenceQueue`'s mocked model-readiness check (from T016) with the real `modelStore.isReadyForInference()` in `src/inference/InferenceQueue.ts`; depends on T016, T025

**Checkpoint**: Device gating and the full download/setup flow are functional; User Story 1's ask loop is now backed by a real model lifecycle instead of a test mock.

---

## Phase 5: User Story 3 - Review and manage past questions (Priority: P3)

**Goal**: Every completed Q&A session is saved locally; the user can browse, delete one, or clear all history.

**Independent Test**: Complete several ask flows, open history, confirm entries with metrics appear, delete one and clear all, confirm the list updates immediately each time and deleted entries never return (spec.md US3 Acceptance Scenarios 1–3).

### Tests for User Story 3

- [X] T028 [P] [US3] Unit tests for the history store in `tests/unit/history/HistoryStore.test.ts` against a test MMKV instance: `save` persists a terminal-state session; `list` returns newest-first; `delete` removes an entry such that a later `get` returns `null`; `clear` empties the list; `setFlag` on a nonexistent id no-ops rather than throwing — per `contracts/history-store.contract.md`

### Implementation for User Story 3

- [X] T029 [US3] Implement `HistoryStore` in `src/history/HistoryStore.ts` (MMKV-backed, using the T008 instance), satisfying T028
- [X] T030 [US3] Create the `historyStore` (Zustand) in `src/store/historyStore.ts` wrapping `HistoryStore` for screen consumption; depends on T029
- [X] T031 [US3] Wire `inferenceStore` (T018) to call `historyStore.save()` with the completed `QASession` + `PerformanceMetrics` on every `'completed'` transition (FR-015) in `src/store/inferenceStore.ts`; depends on T018, T030
- [X] T032 [US3] Implement `HistoryScreen.tsx` in `src/screens/HistoryScreen.tsx` — list with question/answer/metrics, delete-one, clear-all, and an empty state; depends on T030

**Checkpoint**: Completed sessions are now persisted and fully manageable from the History screen.

---

## Phase 6: User Story 4 - Flag a bad answer (Priority: P4)

**Goal**: Mark a specific answer as incorrect/unhelpful without leaving the current screen.

**Independent Test**: After receiving an answer, trigger the report action, confirm the session is flagged without navigating away and with no network activity, then confirm it shows as flagged in History (spec.md US4 Acceptance Scenarios 1–2).

- [X] T033 [US4] Expose a `setFlag` action on the `historyStore` (T030) in `src/store/historyStore.ts`
- [X] T034 [P] [US4] Implement `ReportButton.tsx` in `src/components/ReportButton.tsx` — single-tap flag action, no navigation side effect; depends on T033
- [X] T035 [US4] Mount `ReportButton` on `AnswerScreen.tsx` (T020) and render the flagged indicator on entries in `HistoryScreen.tsx` (T032); depends on T020, T032, T034

**Checkpoint**: Reporting is available end-to-end and visible in history.

---

## Phase 7: User Story 5 - See performance trends (Priority: P5)

**Goal**: Visualize the five recorded metrics across past sessions.

**Independent Test**: After several completed sessions, open the benchmark screen and confirm all five metrics are visualized across those sessions; with zero sessions, confirm an empty informational state instead of an error (spec.md US5 Acceptance Scenarios 1–2).

- [X] T036 [P] [US5] Implement `BenchmarkScreen.tsx` in `src/screens/BenchmarkScreen.tsx` — visualizes the five `PerformanceMetrics` fields across `historyStore.list()`, with an empty state when the list is empty; depends on T030

**Checkpoint**: All five screens are functional; every user story is independently demonstrable.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Contract-level verification, cross-module integration checks, and the manual on-device validation pass.

- [X] T037 [P] Implement `OfflineIndicator.tsx` in `src/components/OfflineIndicator.tsx` and mount it on `CaptureScreen.tsx` and `AnswerScreen.tsx`
- [X] T038 [P] Contract test asserting every pre/postcondition in `contracts/inference-pipeline.contract.md` in `tests/contract/inference-pipeline.test.ts`
- [X] T039 [P] Contract test asserting every pre/postcondition in `contracts/model-lifecycle.contract.md` in `tests/contract/model-lifecycle.test.ts`
- [X] T040 [P] Contract test asserting every pre/postcondition in `contracts/history-store.contract.md` in `tests/contract/history-store.test.ts`
- [X] T041 [P] Integration test for the full capture→answer flow with airplane mode enabled, asserting zero network requests are observed, in `tests/integration/ask-flow.test.ts`
- [X] T042 [P] Integration test for the missing-model → download → integrity-verified → ready flow, including a simulated interrupted-then-resumed download, in `tests/integration/model-setup-flow.test.ts`
- [ ] T043 Run all seven `quickstart.md` scenarios on a physical Android 13+ device with 6–8GB RAM and record pass/fail results, including the 50-attempt sustained-use crash check (SC-008)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories (explicit ordering constraint: `DeviceCompatibility` before anything touching model loading)
- **User Story 1 (Phase 3)**: Depends on Foundational only (uses a mocked model-readiness gate) — this is the MVP
- **User Story 2 (Phase 4)**: Depends on Foundational; T027 additionally depends on US1's T016 to replace its mock — can otherwise be built in parallel with US1
- **User Story 3 (Phase 5)**: Depends on Foundational (T008) and on US1's T018 for the wiring task T031 — the `HistoryStore` module itself (T028–T029) can be built in parallel with US1/US2
- **User Story 4 (Phase 6)**: Depends on US3 (T030) and US1 (T020)
- **User Story 5 (Phase 7)**: Depends on US3 (T030) only
- **Polish (Phase 8)**: Depends on all user stories being complete

### Explicit Ordering Constraints (from feature input)

1. Unit tests for `InferenceQueue`, `InferenceMetrics`, `ImagePreprocessor` (T011–T013) precede their implementations (T014–T016).
2. Unit tests for `DeviceCompatibility`, `ModelDownloadManager`, `ModelIntegrity` (T009, T021, T022) precede their implementations (T010, T023, T024).
3. `DeviceCompatibility` (T010) precedes every task that touches model loading: T016, T024.
4. `InferenceQueue` (T016) precedes every screen that triggers inference: T019, T020.
5. `ModelSetupScreen` (T026) is implementable and testable against a mocked `modelStore` — it does not require T024's real download to have run.

### Within Each User Story

- Tests before implementation (Principle VI, NON-NEGOTIABLE for US1/US2's modules)
- Modules before stores before screens
- Story complete and checkpointed before the next priority is required to start (though US1/US2/US3's module-level work can overlap — see Phase Dependencies above)

---

## Parallel Example: User Story 1

```bash
# Tests can be written in parallel (different files):
Task: "Unit tests for ImagePreprocessor in tests/unit/inference/ImagePreprocessor.test.ts"
Task: "Unit tests for InferenceMetrics in tests/unit/inference/InferenceMetrics.test.ts"
Task: "Unit tests for InferenceQueue in tests/unit/inference/InferenceQueue.test.ts"

# Once tests exist, ImagePreprocessor and InferenceMetrics implementations are independent:
Task: "Implement ImagePreprocessor in src/inference/ImagePreprocessor.ts"
Task: "Implement InferenceMetrics in src/inference/InferenceMetrics.ts"
# InferenceQueue depends on both of the above and must run after them
```

## Parallel Example: User Story 2

```bash
Task: "Unit tests for ModelIntegrity in tests/unit/model/ModelIntegrity.test.ts"
Task: "Unit tests for ModelDownloadManager in tests/unit/model/ModelDownloadManager.test.ts"
# ModelIntegrity implementation can proceed in parallel with writing the ModelDownloadManager tests,
# since ModelDownloadManager's implementation (T024) depends on ModelIntegrity (T023) but not vice versa
Task: "Implement ModelIntegrity in src/model/ModelIntegrity.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational)
2. Complete Phase 3 (User Story 1) — ask loop against a mocked model-readiness gate
3. **STOP and VALIDATE**: run Scenario 1 of `quickstart.md` (airplane mode ask flow) with a manually pre-placed, hand-verified model file
4. This is a demonstrable MVP even before US2's real download flow exists

### Incremental Delivery

1. Setup + Foundational → device compatibility gate ready
2. Add User Story 1 → validate → MVP demo (against a mocked model gate)
3. Add User Story 2 → validate → real model download replaces the mock (T027)
4. Add User Story 3 → validate → history persists and is manageable
5. Add User Story 4 → validate → reporting works
6. Add User Story 5 → validate → benchmarks visualize real recorded data
7. Polish phase → contract/integration tests + physical-device quickstart pass

### Parallel Team Strategy

With more than one contributor:
- After Foundational: one contributor takes US1's inference cluster (T011–T020), another takes US2's model cluster (T021–T026) in parallel — they only meet at T027's integration point
- US3's `HistoryStore` (T028–T029) can start as soon as T008 (MMKV instance) exists, independent of both US1 and US2, and only needs US1's T018 for the final wiring task (T031)

---

## Notes

- [P] tasks touch different files with no incomplete-task dependencies
- [Story] labels trace each task back to its spec.md user story
- Every module-level implementation task names the exact test task it must satisfy, per constitution Principle VI
- Commit after each task or logical group, per the "single agent session" scoping requested for this feature
- Verify each test task's tests fail before starting its paired implementation task
