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

## Phase 9: Phase 2 Enhancements (Post-MVP Feature Additions)

**Purpose**: Fourteen post-MVP features (F01–F14, spec.md "Phase 2 Additions" FR-025–FR-038) layered onto the completed Phase 1 app. Numbering continues from T043; T044/T045 correspond to F03/F04 specifically, per those features' own task references. Task IDs are assigned in the order the features were specified, then resequenced into strict ascending numeric order below (see each task's `blocks`/`depends on` note for the true execution order where it differs from numeric order — most visibly, T060 depends on the later-numbered T064).

- [X] T044 — Streaming SHA-256 integrity verification — Chunked/incremental SHA-256 hashing in `src/model/ModelIntegrity.ts` so the 2.4GB model file is never loaded into a single JS ArrayBuffer (FR-027); already implemented and covered by `tests/unit/model/ModelIntegrity.test.ts` — blocks: none
- [X] T045 — Remote model configuration endpoint — Fetch the expected SHA-256 hash and file size for the pinned model from a hosted JSON endpoint once at the start of each download attempt, replacing the hardcoded `MODEL_SHA256`/`MODEL_FILE_SIZE` constants in `src/store/modelStore.ts`; do not cache the fetched config between sessions (FR-028); per constitution Principle VI, write `tests/unit/model/ModelConfig.test.ts` before implementing — blocks: none
- [X] T046 — [P] Verify existing background-download capability — Confirm whether `react-native-executorch-expo-resource-fetcher` v0.9.2's `ExpoResourceFetcher` already wraps `@kesha-antonov/react-native-background-downloader` (or an equivalent OS-level background transfer) before adding any new dependency, per constitution Principle IX; document findings in `research.md` (FR-025) — blocks: T047
- [X] T047 — Background model download + persistent notification — Continue the model download when the app is backgrounded and show a persistent Android notification with download percentage and MB downloaded; tapping it returns the user to `ModelSetupScreen`; pause/resume/cancel remain functional from the notification; use Android 14+ UIDT (User-Initiated Data Transfer) jobs (FR-025) — blocks: none; depends on T046. Implemented via `@kesha-antonov/react-native-background-downloader` 4.5.6, chosen per T046 research; NDK gate passed — pure Kotlin, no CMakeLists. DONE: lib installed; Expo config plugin registered with `skipMmkvDependency:true` (no RN-MMKV conflict); `POST_NOTIFICATIONS` added to app.json (FGS perms + service come from the lib's merged manifest); `src/model/BackgroundDownloadFetcher.ts` implements `ResourceFetcherLike` backed by kesha (attaches handlers then `start()`s the PENDING task; cancel rejects the in-flight fetch), writing to executorch's exact `RNEDirectory + getFilenameFromUri(url)` path, TDD-covered by `tests/unit/model/BackgroundDownloadFetcher.test.ts`; the fetcher is wired into `ModelDownloadManager` at the `modelStore` composition root (swapped in for `ExpoResourceFetcher`, which stays imported for listing + registered with `initExecutorch` for `useLLM`); `setConfig` sets the notification title/progress text; the kesha↔`BgDownloadTask` adapter, `getFilenameFromUri` destination resolver, and file existence/delete/list/ensure-dir are all wired via expo-file-system; reattach is wired via `getExistingDownloadTasks()` in the launch bootstrap before filesystem reconciliation, with native tasks mapped back to model sources by executorch destination filename and completion routed through the same SHA-256 verification state machine. `IModelLifecycle` unchanged. Release validation to perform on the EAS/device build: Play Console *App content → Foreground services* `dataSync`/UIDT declaration; on-device smoke test in `quickstart.md` (verify the file lands at executorch's path, progress/notification, pause/resume/cancel, app-kill reattach/background survival, and notification tap behavior supported by the native package/build).
- [X] T048 — [P] Unit tests for the cellular-download gate — Write `tests/unit/model/NetworkGate.test.ts`: cellular connection detected → gate returns a warning state (not silently blocked or silently downloaded); WiFi connection detected → no gate; a persisted "download anyway" choice is honored without re-prompting (FR-026); must fail before implementation — blocks: T049
- [X] T049 — Cellular/WiFi download gate — Implement a network-type check (e.g. `src/model/NetworkGate.ts`) invoked before `ModelDownloadManager.startDownload()`; on a metered connection, `ModelSetupScreen.tsx` shows the ~2.4GB warning with "Wait for WiFi" / "Download anyway" choices; a chosen "download anyway" is persisted in MMKV so it is not asked again on resume (FR-026); satisfies T048 — blocks: none
- [X] T050 — [P] Replace unicode glyph icons with a vector icon library — Replace every unicode icon glyph (☰, ‹, ⚑, ▦, ⟲, and any others) across all screens/components with `@expo/vector-icons`; verify zero unicode icon glyphs remain in `src/screens` and `src/components` (FR-029) — blocks: none
- [X] T051 — [P] Extend `QASession` with multi-turn `turns[]` — Add `turns: Array<{ question: string; answer: string }>` to the `QASession` type in `src/types/models.ts`, matching the `data-model.md` update (FR-030) — blocks: T052, T053
- [X] T052 — Unit tests for multi-turn follow-up exchanges — Write tests (e.g. `tests/unit/inference/MultiTurnFollowUp.test.ts`) covering: the image is attached only on the first turn; follow-up turns are sent text-only via `useLLM`'s `messageHistory`/`SlidingWindowContextStrategy`; the full exchange persists as one history entry (FR-030); must fail before implementation — blocks: T053
- [X] T053 — Implement multi-turn follow-up flow — Wire `InferenceQueue`/`useInferenceEngine` so a follow-up `submit()` on an already-completed session sends a text-only turn relying on `useLLM`'s built-in conversation history, and persist the growing `turns[]` array as a single `HistoryStore` entry per session id; depends on T051, T052; satisfies T052 — blocks: T054
- [X] T054 — Follow-up question UI on `AnswerScreen.tsx` — After an answer completes, show a question input allowing another turn about the same image without navigating away, appending each exchange to the visible thread (FR-030); depends on T053 — blocks: none
- [ ] T055 — [P] Copy answer to clipboard — Add a copy button on `AnswerScreen.tsx`, visible once inference completes, that copies the answer text via `expo-clipboard` with a haptic + brief toast confirmation and no navigation (FR-031); requires adding the `expo-clipboard` dependency — blocks: none
- [ ] T056 — [P] Share answer — Add a share button on `AnswerScreen.tsx`, visible once inference completes, that opens the native Android share sheet with the question and answer as plain text via React Native's built-in `Share` API (no new dependency, no image, no network activity) (FR-032) — blocks: none
- [ ] T057 — [P] Unit tests for voice/VLM mutual exclusion — Write tests asserting an in-progress voice transcription blocks a VLM `submit()` and vice versa, sharing (or coordinating with) `InferenceQueue`'s single-flight lock (FR-033); must fail before implementation — blocks: T058
- [ ] T058 — On-device voice transcription via `useWhisper` — Implement `src/inference/useVoiceTranscription.ts` as the sanctioned `useWhisper` (react-native-executorch) call site, mirroring `useInferenceEngine.ts`'s hook-isolation pattern, enforcing mutual exclusion with the VLM `InferenceQueue` (FR-033); satisfies T057 — blocks: T059
- [ ] T059 — Hold-to-record button on `CaptureScreen.tsx` — Add a hold-to-record control that transcribes speech into the question input for the user to review/edit before submitting (does not auto-submit) (FR-033); depends on T058 — blocks: none
- [ ] T060 — Text-only fallback model recommendation — Extend `modelStore`/`ModelSetupScreen.tsx` to recommend the Qwen 3 0.6B text-only model when `DeviceCompatibilityResult` indicates the vision model cannot run (<6GB RAM), keeping `IModelLifecycle` platform-agnostic (model selection stays a store-level concern) (FR-034); depends on T064 (multi-model selector, F14) — blocks: none
- [ ] T061 — [P] Flag with optional note — Add an optional free-text note (max 120 characters) shown when the user taps "Flag answer" on `AnswerScreen.tsx`, wired to the existing `historyStore.setFlag(id, true, note)` action; display the note beside the flagged indicator in `HistoryScreen.tsx` (FR-035) — blocks: none
- [ ] T062 — [P] Search history by question text — Add a search input to `HistoryScreen.tsx` filtering the in-memory session list by case-insensitive substring match against `question`, with no additional MMKV reads (FR-036) — blocks: none
- [ ] T063 — [P] Pinch-to-zoom on the captured image — Add bounded pinch-to-zoom on the image thumbnail in `AnswerScreen.tsx` using Reanimated gestures, resetting zoom on navigation away; verify `react-native-gesture-handler` is configured with a `GestureHandlerRootView` at the app root (likely already present transitively via React Navigation, but unconfirmed) (FR-037) — blocks: none
- [ ] T064 — Multi-model selector — `ModelSetupScreen.tsx` lists available on-device models with recommended status (from `DeviceCompatibilityResult`), storage size, and minimum RAM requirement, letting the user choose which single model is active; keep `IModelLifecycle` platform-agnostic — model selection stays a store-level concern (FR-038); prerequisite for T060 (F10) — blocks: T060

**Checkpoint**: All fourteen Phase 2 features implemented and tested; F10/F14's cross-dependency (T064 before T060) resolved regardless of numeric order.

---

## Phase 10: Phase 3 Enhancements (Multi-Turn Reliability, Vision-Once Text-Chat, Resumable Threads, Input/Output Quality)

**Purpose**: Six workstreams, in build order, layered onto the completed Phase 1+2 app: (1) fix the T054 multi-turn context-loss report, (2) split inference into a vision-once extraction turn plus text-only follow-up turns on one long-lived engine instance, (3) make pinned-extraction-plus-sliding-window the explicit context-management floor, (4) persist and resume full chat threads with a clean-slate reset on new capture, (5) preprocess captured images and tighten the system prompt, (6) tune generation output quality within the library's actually-confirmed API surface. Numbering continues from T064.

**Do NOT implement yet — this phase is written for the user to trigger one task at a time.**

**Device-gated tasks** are marked `[DEVICE]` — they require a physical Android 13+ device (an EAS-built dev client, per `plan.md`'s Build Strategy; local Gradle builds remain permanently out of scope on this machine) and cannot be completed by a unit/integration test alone.

**Verified-API constraint governing this whole phase** (`research.md`'s "Phase 3 API Verification", checked against the actually-installed `react-native-executorch` 0.9.2): `topK`, native `maxTokens`, and native `sequenceLength` do **not** exist on this version's `GenerationConfig`, and no grammar/JSON-constrained decoding feature exists at all. Every task below that touches generation config or output-length/structure enforcement is written to that verified reality — do not reintroduce any of those three names into code without re-verifying against whatever `react-native-executorch` version is installed at the time.

### Workstream 1 — Multi-turn context fix (T054 root cause; highest priority)

- [X] T065 [P] Contract test: turn 2's context contains turn 1 under realistic timing — add a test (e.g. `tests/unit/store/inferenceStore.followUpContext.test.ts`) that simulates the render-tick delay between a completed first turn and `useLLM`'s `messageHistory` update (`research.md`'s root-cause note, suspect 1) and asserts a follow-up submitted in that window still carries turn 1's context rather than rejecting or silently losing it (FR-040); must fail against the current fixed-250ms `waitForMessageHistory` (`src/store/inferenceStore.ts:276-310`) before T066 — blocks: T066
- [X] T066 Replace the fixed-timeout race with a deterministic wait — rework `waitForMessageHistory` in `src/store/inferenceStore.ts` so a follow-up waits on the engine's actual settled state rather than a hardcoded 250ms timer, satisfying T065 (FR-039, FR-040) — depends on T065 — blocks: T067
- [X] T067 Harden the engine-host mount against mid-session remount — make `src/navigation/AppNavigator.tsx`'s conditional `InferenceEngineHost` mount (currently gated on the `engineReady` boolean derived from `modelStore`) structurally unable to unmount/remount once mounted for the app process's lifetime, and add a unit test asserting `configureForLongResponses()` (`src/inference/useInferenceEngine.ts:77-91`) never re-fires with `initialMessageHistory: []` after its first successful configure (FR-039) — depends on T066 (same subsystem, sequenced to avoid conflicting edits) — blocks: T068
- [ ] T068 [DEVICE] Manual on-device validation of multi-turn context — on a physical Android 13+ device, run a 3+ turn follow-up conversation about one captured image and confirm the final turn's answer correctly reflects turn 1's context; record the scenario and result in `quickstart.md` — depends on T066, T067

### Workstream 2 — Vision-once → text-chat (single VLM instance, no second model)

- [X] T069 [P] Unit tests for the structured-extraction prompt — `tests/unit/inference/ExtractionPrompt.test.ts`: the built prompt instructs labeled findings for subject/object, visible features, visible text, and visible condition; must fail before implementation (FR-041) — blocks: T070
- [X] T070 Implement the extraction-prompt builder — `src/inference/ExtractionPrompt.ts`, satisfying T069 (FR-041) — depends on T069 — blocks: T072
- [X] T071 [P] Unit tests for JSON extraction parsing + single retry — `tests/unit/inference/ExtractionParser.test.ts`: well-formed JSON parses to the labeled fields; malformed JSON triggers exactly one corrective retry using the extraction prompt; a second failure falls back to storing the raw text rather than throwing; must fail before implementation (FR-053) — blocks: T072
- [X] T072 Implement extraction parsing + retry — `src/inference/ExtractionParser.ts`, satisfying T071; consumes T070's prompt builder for the corrective retry (FR-053) — depends on T070, T071 — blocks: T073
- [X] T073 Wire turn 1 as the extraction turn — update `saveFirstTurnSession`'s call path in `src/store/inferenceStore.ts` to run the image through T070's prompt and T072's parser, store the result on the new `QASession.pinnedExtraction` field (`data-model.md`), and surface the parsed findings as the visible turn-1 answer (FR-041, FR-053) — depends on T072 — blocks: T074
- [X] T074 Wire turn 2+ as pinned-context, text-only turns — update the follow-up path in `src/inference/InferenceQueue.ts`/`src/store/inferenceStore.ts` so every follow-up's constructed context explicitly includes `pinnedExtraction` (FR-042) rather than relying solely on `useLLM`'s own raw `messageHistory`; add a unit test asserting the pinned extraction is present in a follow-up's context even when the underlying message history has been trimmed (FR-042, FR-044) — depends on T073 — blocks: T076
- [ ] T075 [DEFERRED — do not schedule work against this yet] "Look again" re-extraction (FR-043) — re-run the structured-extraction step against a thread's original stored image without starting a new thread. Per the Phase 3 Scope Note in `spec.md`, this is specified but explicitly not part of this batch; pick up only once T069–T074 are live and stable on-device.

### Workstream 3 — Context management

- [X] T076 Enforce the pinned-plus-sliding-window floor explicitly — extend the context construction introduced in T074 so it demonstrably combines `pinnedExtraction` with the most recent K verbatim turns via the existing `SlidingWindowContextStrategy`, and add a unit test asserting the pinned extraction is never evicted even when K is exceeded (FR-044) — depends on T074 — blocks: none
- [ ] T077 [P] [DEFERRED — do not schedule work against this yet] Rolling summarization of turns older than the sliding window — explicitly out of scope for this batch (FR-044 note, Phase 3 Scope Note in `spec.md`); build only once a real conversation is observed overflowing the context window, not speculatively.

### Workstream 4 — Resumable chats + state reset

- [X] T078 [P] Unit tests for chat-thread hydration — `tests/unit/store/inferenceStore.hydration.test.ts`: hydration loads the full persisted turn list, a post-hydration follow-up appends to the SAME session id without hanging (fresh-process path), unknown ids return null, reset clears thread + engine history, and a completed first turn records its id as the active thread (FR-045, FR-046) — blocks: T079
- [X] T079 Implement thread hydration — `hydrateSession(sessionId)` + `activeSessionId` on `src/store/inferenceStore.ts`, satisfying T078 (FR-046). Includes the fresh-process deadlock fix: the pre-send message-history wait is skipped when no turn has been served by this engine instance in this process (`engineTurnsServed`), since a hydrated thread's pinned-context prompt is self-contained — depends on T078 — blocks: T080
- [X] T080 Wire History → continue navigation — `HistoryScreen.tsx` cards are tappable (whole card + explicit Continue button), navigating to `Answer` keyed by `{ sessionId }`; `AnswerScreen.tsx` seeds its thread read-only from `historyStore.get()` and hydrates via T079 in a mount effect; `Answer` route params are now a union of fresh-ask and resume modes; delete/clear unchanged (FR-046) — depends on T079 — blocks: T081
- [X] T081 Implement commit-on-navigate-away + clean-slate reset — `resetActiveChat()` on `inferenceStore` (cancels in-flight, clears `lastSavedSession`/`activeTurn`, wipes the engine's managed conversation history via the new `InferenceEngineHandle.clearHistory()`, resets to idle), wired to `CaptureScreen`'s navigation `focus` listener so every return-to-camera is a clean slate; completed turns were already committed at completion, and an in-flight turn on navigate-away is cancelled per FR-007 (never partial-saved); covered by T078's reset test + T096 (FR-047) — depends on T080 — blocks: T083
- [X] T082 [P] Call `interrupt()` before the chat screen unmounts — unmount effect in `AnswerScreen.tsx` cancels any in-flight generation; asserted by the screen-wiring test in `tests/unit/store/inferenceStore.hydration.test.ts` (no component-render test framework in this repo — source-assertion pattern per existing convention) (FR-048) — depends on none — blocks: T083
- [ ] T083 [DEVICE] Manual on-device validation of resumable threads — run `quickstart.md` Scenario 9 (added) on a physical device and record pass/fail; requires a fresh EAS dev-client build since this batch adds the `expo-image-manipulator` native module — depends on T081, T082

### Workstream 5 — Input enhancements

- [X] T084 Add the `expo-image-manipulator` dependency — installed `~56.0.20` via `npx expo install` (SDK 56 band); verified its action surface at implementation time: resize/rotate/flip/crop only, NO contrast action — recorded as `research.md` Phase 3 API Verification (d) (FR-049) — blocks: T085
- [X] T085 [P] Unit tests for the image-enhancement stage — `tests/unit/inference/ImageEnhancer.test.ts` (10 tests): orientation-bake pass always runs first; large images downscale to the 1024 intermediate ceiling on the correct axis; extreme aspect ratios center-crop to 16:9; provided subject regions clamp to bounds; normal frames stay uncropped (the sensible centered default is the full frame); enhance→preprocess chaining and the fallback-on-failure path (FR-049) — depends on T084 — blocks: T086
- [X] T086 Implement the image-enhancement stage — `src/inference/ImageEnhancer.ts`: two-pass `manipulateAsync` (EXIF-orientation bake → crop/downscale), `resolveCropRegion` with subject-region clamping, 1024 intermediate ceiling. Contrast normalization omitted — impossible at the RN layer with current dependencies (research.md (d)); spec FR-049 amended accordingly — depends on T085 — blocks: T087
- [X] T087 Wire the enhancement stage into the inference pipeline — `prepareImageForInference` (enhance → 512 ceiling, with graceful fallback to the raw capture if enhancement fails) is now `createInferenceQueue`'s default `preprocess`; asserted in `tests/unit/inference/InferenceQueue.test.ts` (FR-049) — depends on T086 — blocks: none
- [X] T088 [P] Author the negative-constraint system prompt — `src/inference/SystemPrompt.ts` (`LOCRA_SYSTEM_PROMPT`: role + visible-only/no-speculation/concise/finish-sentences constraints) replaces `DEFAULT_SYSTEM_PROMPT` in `configureForLongResponses()`; asserted in `tests/unit/inference/GenerationTuning.test.ts` (FR-050) — depends on none — blocks: none

### Workstream 6 — Output enhancements

- [X] T089 [P] Unit tests for tuned generation config — `tests/unit/inference/GenerationTuning.test.ts`: `LOCRA_GENERATION_CONFIG` equals exactly `{ temperature: 0.35, repetitionPenalty: 1.05, minP: 0.05 }`, no `topK`/`maxTokens`/`sequenceLength` anywhere, and `useInferenceEngine` passes it to `configure()` (FR-051) — blocks: T090
- [X] T090 Apply the tuned generation config — `src/inference/GenerationTuning.ts` + `configureForLongResponses()` now passes `generationConfig: LOCRA_GENERATION_CONFIG` alongside `chatConfig`, satisfying T089 (FR-051) — depends on T089 — blocks: none
- [X] T091 [P] Unit tests for the app-level output-length cap — extended `tests/unit/inference/InferenceQueue.test.ts`: an engine streaming indefinitely is aborted once `generatedTokenCount` reaches `OUTPUT_TOKEN_BUDGET` (256) and still resolves `'completed'` with the partial response + a visible length-limit notice; under-budget runs are untouched; a budget stop is NOT a user cancel (no `'cancelled'` transition, metrics populated) (FR-052) — blocks: T092
- [X] T092 Implement the app-level output-length cap — `onToken` now carries `generatedTokenCount`; the queue aborts the request signal at budget without setting the cancelled flag, and the engine-adapter contract now requires generate to RESOLVE with the partial on abort (the bridge in `inferenceStore.ts` implements this, including skipping the post-submit history wait after an interrupt) (FR-052) — depends on T091 — blocks: none
- [X] T093 [P] Unit tests for post-processing (trim / truncation / loop detection) — `tests/unit/inference/AnswerPostProcessor.test.ts` (8 tests): trim, mid-sentence truncation detection, trailing-loop detection with repeat collapsing, legitimate non-loop repetition NOT flagged, empty-answer and pure-read (`assessAnswerQuality`) cases (FR-054) — blocks: T094
- [X] T094 Implement post-processing — `src/inference/AnswerPostProcessor.ts` (trim + tail assessment + loop collapsing), applied by the queue on every completion before the answer is visible/persisted; distinct indicators: the `limitWarning` notice card on `AnswerScreen.tsx`, and a per-turn quality tag (`AnswerQualityTag`) on `HistoryScreen.tsx` derived pure-functionally from the persisted text — no schema change (FR-054) — depends on T093 — blocks: T095
- [ ] T095 [DEVICE] On-device validation of output quality — run `quickstart.md` Scenario 10 (added) on a physical device and record pass/fail; requires the same fresh EAS build as T083 — depends on T090, T092, T094

### Cross-cutting

- [X] T096 Integration test: full vision-once → multi-turn → resumed-thread flow — `tests/integration/vision-once-chat-flow.test.ts`: real `inferenceStore` + real `HistoryStore` over in-memory storage (only the engine handle and native modules mocked), covering capture → extraction → two follow-ups → reset (navigate away) → hydrate from history → one more follow-up; asserts pinned extraction in every follow-up prompt, single session id throughout, four persisted turns — depends on T074, T081, T082
- [X] T097 Update contracts for Phase 3 — `contracts/inference-pipeline.contract.md` gained a Phase 3 addendum (abort-resolves adapter contract, `onToken` token-count arg + output cap, deterministic history wait with the hydrated-thread skip, enhance→ceiling preprocessing, post-processing, pinned extraction); `contracts/history-store.contract.md` gained the `pinnedExtraction` persistence + legacy-normalization + session-as-thread rules — depends on T066, T072, T092, T094

**Checkpoint**: Multi-turn context loss is root-caused and fixed; vision-once/text-chat is the standing inference model; pinned-plus-sliding-window context management is explicit and tested; chat threads are fully resumable with a clean-slate reset on new capture; captured images are enhanced before inference; output quality is tuned within the library's verified API surface. FR-043 (Look again) and rolling summarization remain deliberately deferred.

---

## Phase 10 Dependencies & Execution Order

- **Workstream 1 (T065–T068)**: No dependency on the other five workstreams — start immediately; this is the user's stated highest priority.
- **Workstream 2 (T069–T075)**: Independent of Workstream 1's fix, but T073/T074 touch the same `inferenceStore.ts`/`InferenceQueue.ts` files Workstream 1 modifies — sequence Workstream 2's file-touching tasks (T073, T074) after T066/T067 land to avoid merge conflicts, even though there is no functional dependency.
- **Workstream 3 (T076–T077)**: Depends on Workstream 2's T074 (context construction must exist before it can be extended).
- **Workstream 4 (T078–T083)**: Independent of Workstreams 2/3; T082 is independent of T078–T081 and can be done anytime.
- **Workstream 5 (T084–T088)**: Independent of all other workstreams; T088 (system prompt) is independent of T084–T087 (image enhancement).
- **Workstream 6 (T089–T095)**: Independent of all other workstreams; its three task pairs (T089–T090, T091–T092, T093–T094) are mutually independent of each other.
- **Cross-cutting (T096–T097)**: T096 depends on Workstreams 2 and 4 being complete; T097 depends on the specific fixes/features it documents.

### Parallel Opportunity

With more than one contributor, Workstreams 1, 4, 5, and 6 can all start in parallel immediately; Workstream 2 should sequence its `inferenceStore.ts`/`InferenceQueue.ts`-touching tasks after Workstream 1 lands; Workstream 3 waits on Workstream 2.

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
