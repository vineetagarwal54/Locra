# Implementation Plan: Camera Vision Q&A (Phase 1)

**Branch**: `001-camera-vlm-qa` | **Date**: 2026-07-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-camera-vlm-qa/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Locra Phase 1 delivers a five-screen Android app that answers a typed
question about a captured photo using a fully on-device vision-language
model (LFM2.5-VL-1.6B, quantized, via React Native ExecuTorch), with zero
network calls anywhere in the capture→answer path, a single-flight
inference queue, crash-free degradation for unsupported devices and
missing/corrupt models, and local-only history/reporting/benchmarking
backed by MMKV. Research (see `research.md`) surfaced four points where the
feature input's assumed tech stack does not match the library's current
state — most importantly, RN 0.76 is not a supported ExecuTorch version and
the library's real minimum OS (Android 13) is stricter than the project's
existing README claim (API 26) — both are flagged for your confirmation
rather than silently decided.

## Technical Context

**Language/Version**: TypeScript (strict mode, project-wide) on React
Native **0.85.3** (within the 0.81–0.85 confirmed decision band — NOT 0.76
as originally stated, and NOT 0.86 as the initial T001 scaffold pinned; see
`research.md` Flagged Risk 1 and the Phase 1 Setup Findings section: Expo
SDK 57 bundles RN 0.86.0 exclusively, which is outside ExecuTorch's
supported band, so the project runs Expo SDK **56.0.14** instead, which
bundles RN 0.85.3 exactly). New Architecture mandatory (constitution
Principle VII; also an ExecuTorch hard requirement independent of the
constitution).

**Primary Dependencies**: `react-native-executorch` `0.9.2` (`useLLM` hook,
`LFM2_5_VL_1_6B_QUANTIZED` model constant — see `research.md` for why not
the deprecated `LFM2_VL_1_6B_QUANTIZED` alias named in the feature input),
`react-native-executorch-expo-resource-fetcher` `0.9.1` + `expo-file-system`
+ `expo-asset` (required companion packages, not optional — `initExecutorch`
throws without a registered resource fetcher adapter), Expo Dev Client
(custom build via **EAS Build**, not Expo Go — see Build Strategy below),
React Native Vision Camera v5 (+ its peer deps `react-native-nitro-modules`
and `react-native-nitro-image`, installed explicitly per `research.md`),
Zustand (inference/model/history stores), MMKV (all persistence), React
Navigation, React Native Reanimated `4.3.1` + `react-native-worklets`
`0.8.3` (the exact pair Expo SDK 56 resolves natively — see Build Strategy
for why this specific pair matters).

**Dependencies added since this section was originally written** (Phase
2/3 work, each vetted against the same NDK-26/EAS constraints above before
adopting): `expo-clipboard` (T055, copy answer), `expo-image-manipulator`
(T084, image enhancement — no CMake/NDK surface, config-plugin only) and
`expo-audio` (T058, voice capture — also config-plugin only, no native
build risk). None of these required revisiting the NDK pin or Build
Strategy decisions above.

**Storage**: MMKV only (constitution Principle VIII) — see `data-model.md`
for the four entities (`QASession`, `PerformanceMetrics`, `OnDeviceModel`,
`DeviceCompatibilityResult`) and their MMKV key-namespace mapping.

**Testing**: Unit tests (Jest + React Native Testing Library where
components are involved) written before implementation for every function
in the inference pipeline and model lifecycle modules (constitution
Principle VI, NON-NEGOTIABLE) — see `contracts/` for the three module
boundaries those tests target. Manual on-device validation per
`quickstart.md` for the crash-free/airplane-mode/degradation scenarios that
cannot be meaningfully unit-tested (real memory pressure, real camera
hardware, real network radio state).

**Target Platform**: Android only. Minimum OS: **Android 13 (API 33)** —
raised from the project's previously stated API 26 to match ExecuTorch's
actual minimum (`research.md` Flagged Risk 2; requires your sign-off since
it shrinks the addressable device population). Target API 35. Physical
device required for meaningful inference testing (emulators don't reflect
real latency/memory behavior). Verified on Samsung S26 Ultra (SM-S948U1).

**Build Strategy**: All Android builds (development and production) run on
**EAS Build**, not local Gradle — this project has no working local Android
build path, permanently, on this development machine. See `research.md`'s
"Phase 1 Setup Findings" for the full investigation; in short,
`react-native-executorch`'s prebuilt native libraries require NDK 26, while
React Native's own Fabric headers and the `reanimated`/`worklets` pair
Expo SDK 56 resolves natively require NDK 27's compiler — no single NDK
version satisfies both, and this was confirmed by exhausting the
reasonable local fixes (an NDK pin plus a one-line header patch resolves
ExecuTorch vs. RN-core, but not the further NDK 27–only compiler behavior
`reanimated` depends on; a linker-flag relaxation attempt made the build
worse). Two permanent patches, applied automatically:

- `graphicsConversions.h`'s `std::format` call, rewritten to
  `std::to_string` — applied via the npm `postinstall` script
  (`scripts/patch-react-native.js`), since `patch-package`'s git-diff step
  fails independently on this machine.
- `android/build.gradle`'s `ndkVersion` pinned to `26.3.11579264` via a
  root `ext` block plus a `subprojects { afterEvaluate { ... } }` hook —
  this is **not** persisted automatically and MUST be re-applied by hand
  after every `expo prebuild`, since prebuild regenerates `android/` from
  the Expo template. (EAS Build's managed prebuild step needs the same fix;
  tracked as a follow-up to move this into an Expo config plugin so EAS
  applies it automatically rather than relying on a locally-regenerated,
  hand-patched `android/build.gradle`.)

Local development uses `npx expo start --dev-client --clear` against an
EAS-built dev client APK installed on a physical device over USB (`adb
reverse tcp:8081 tcp:8081`) — Metro/JS iteration does not require a native
rebuild. `app.json`'s `runtimeVersion` policy is `sdkVersion` so the JS
bundle and EAS-built native binary stay compatible without a full rebuild
on every JS-only change.

**Project Type**: Mobile app (single React Native project, no separate
backend — there is no backend in this architecture by design).

**Performance Goals**: Per the project's existing README targets — app
cold start <3s, model load (cold) <8s, first-token latency <5s, ≥5
tokens/sec, capture→answer-start <500ms excluding model load — measured via
the `PerformanceMetrics` this feature records (FR-008).

**Constraints**: Zero network calls anywhere in capture→preprocess→model→
answer→persist (constitution Principle I). Single in-flight inference at a
time (Principle II). Image preprocessing hard-capped at 512×512 before
tensor creation (Principle IV). Device compatibility MUST be checked before
model load — and since ExecuTorch provides no such check itself
(`research.md`), this is fully custom app code. 6–8GB RAM target devices.

**Scale/Scope**: 5 screens, 3 persisted entity types (`QASession` embeds
`PerformanceMetrics`) plus 2 non-persisted gate results
(`OnDeviceModel`/`DeviceCompatibilityResult` are recomputed each launch),
single user, single device, no accounts, no multi-tenancy.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Privacy-First Architecture | Inference module makes zero network calls | **PASS** — `inference-pipeline.contract.md` structurally excludes networking imports; `research.md` confirms ExecuTorch inference itself is local-only. Model *download* (separate from inference) is the one legitimate network use, matching the spec's own Assumptions. |
| II. Single-Flight Inference Queue | Lock acquired before preprocessing, released after persist/error/cancel | **PASS** — `inference-pipeline.contract.md` `submit()` precondition rejects concurrent calls; postconditions require lock release on every exit path. |
| III. Graceful Degradation Over Crashes | Unsupported device / missing model / OOM / cancel all reach a clean UI state | **PASS** — covered by `model-lifecycle.contract.md` (compatibility check never throws) and `inference-pipeline.contract.md` (OOM → `'errored'`, not a crash). |
| IV. Memory Safety on Constrained Hardware | 512×512 ceiling; compatibility checked before load | **PASS**, with a caveat — the ceiling and check-before-load sequencing are designed in, but see Flagged Risk 2: the *definition* of "supported" is now Android 13/RAM-gated per library reality, which changes who ever reaches the memory-safe path at all. |
| V. Minimal, Readable TypeScript | No `any`, strict mode | **PASS** — no violations anticipated; contracts are written as plain interfaces. |
| VI. TDD for Core Systems | Tests before implementation for inference + model lifecycle | **PASS** — flagged as a required Phase 2 task ordering constraint (tests precede implementation tasks per module). |
| VII. New Architecture Only | No New-Architecture-disabling dependency | **PASS** — all chosen dependencies (ExecuTorch, Vision Camera v5, Reanimated) require or support New Architecture. |
| VIII. Single Local Store | MMKV only | **PASS** — `history-store.contract.md` forbids AsyncStorage/SQLite imports structurally. |
| IX. Verify Before Assuming | ExecuTorch API verified against current docs, not assumed | **PASS, this is the point of `research.md`** — four assumptions in the feature input were checked and two were found to be materially wrong (RN version, model constant name), which is exactly this principle in action. |
| X. Hard Architecture Boundaries | Screens/inference/model-lifecycle isolation | **CONDITIONAL PASS** — see `research.md`'s "Architecture boundary tension": `useLLM` is unavoidably a React hook, so a literal zero-UI-imports reading is unsatisfiable. Resolved via a documented interpretation (business logic in plain `.ts`, one thin hook as the sanctioned adapter) rather than silently violating or silently reinterpreting the principle. Flagging this resolution for your confirmation, not just noting it. |

No gate is a hard failure. Two are conditional/flagged pending your
confirmation (Principle IV's downstream effect via Flagged Risk 2, and
Principle X's hook-boundary interpretation) — both are called out above
and in `research.md` rather than resolved unilaterally, per the "flag
rather than guess" instruction on this feature.

## Project Structure

### Documentation (this feature)

```text
specs/001-camera-vlm-qa/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   ├── inference-pipeline.contract.md
│   ├── model-lifecycle.contract.md
│   └── history-store.contract.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

This is a single React Native (Expo Dev Client) mobile project — there is
no backend, so Option 1 (single project) applies, laid out per the
project's existing `README.md` structure and the constitution's hard
architecture boundaries (Principle X):

```text
src/
├── screens/
│   ├── CaptureScreen.tsx        # US1 — camera + prompt input; no business logic, reads inference/model stores
│   ├── AnswerScreen.tsx         # US1/US4 — streamed answer + metrics + report action
│   ├── HistoryScreen.tsx        # US3 — local Q&A history list, delete/clear
│   ├── ModelSetupScreen.tsx     # US2 — device compatibility + download/setup
│   └── BenchmarkScreen.tsx      # US5 — performance visualization across sessions
├── inference/                   # contracts/inference-pipeline.contract.md — zero UI imports except its own adapter hook
│   ├── InferenceQueue.ts        # single-flight lock, submit/cancel, state machine
│   ├── InferenceMetrics.ts      # timing instrumentation (all 5 metrics — none provided by ExecuTorch itself)
│   ├── ImagePreprocessor.ts     # resize/compress to ≤512×512 ceiling
│   └── useInferenceEngine.ts    # the one sanctioned useLLM call site (research.md boundary resolution)
├── model/                       # contracts/model-lifecycle.contract.md — self-contained, no imports from inference/ or screens/
│   ├── DeviceCompatibility.ts   # RAM/OS check, run before any model load
│   ├── ModelDownloadManager.ts  # ExpoResourceFetcher wrapper: start/pause/resume/cancel
│   └── ModelIntegrity.ts        # SHA-256 verification (app-level; not provided by ExecuTorch)
├── store/                       # Zustand — screens read these, never the modules directly
│   ├── inferenceStore.ts
│   ├── modelStore.ts
│   └── historyStore.ts          # backed by contracts/history-store.contract.md
├── history/
│   └── HistoryStore.ts          # MMKV-backed implementation behind the historyStore contract
└── components/
    ├── OfflineIndicator.tsx
    └── ReportButton.tsx         # US4

tests/
├── unit/
│   ├── inference/                # Principle VI: written before InferenceQueue.ts, InferenceMetrics.ts, ImagePreprocessor.ts
│   └── model/                    # Principle VI: written before DeviceCompatibility.ts, ModelDownloadManager.ts, ModelIntegrity.ts
├── contract/                     # one spec per file in contracts/, asserting the pre/postconditions documented there
└── integration/                  # multi-module flows: capture→answer, missing-model→download→ready
```

**Structure Decision**: Single project, no backend. The three constitution
module boundaries (`inference/`, `model/`, and the history store) each get
their own top-level directory with a corresponding `contracts/*.md` file so
their public interface is reviewable independently of implementation. Note
one naming discrepancy against the existing `README.md`, which documents
the device-compatibility check as `src/inference/DeviceGate.ts`: this plan
places it at `src/model/DeviceCompatibility.ts` instead, because
compatibility-before-load is a model-lifecycle concern under Principle X
(the inference module should not need to know *why* a model isn't ready,
only that `isReadyForInference()` is false). Flagging so the README can be
updated to match rather than the plan carrying forward a path that
contradicts the module boundary it's supposed to respect.

## Complexity Tracking

No unjustified constitution violations — the two conditional items in the
Constitution Check table above (Principle IV's redefinition of "supported
device," Principle X's hook-boundary interpretation) are flagged
discoveries/interpretations to confirm with you, not complexity being
smuggled past the gate. Nothing here requires a "simpler alternative was
rejected because" justification; there is no 4th project, no added
architectural layer beyond what the constitution already mandates.

## Phase 3 Technical Notes (Multi-Turn Reliability, Vision-Once, Resumable Threads)

Covers spec.md's Phase 3 Additions (FR-039–FR-054). No new project/backend;
all changes stay inside the existing `src/inference/`, `src/store/`,
`src/history/`, `src/screens/` boundaries from the Project Structure above.

**New dependency**: `expo-image-manipulator` — for FR-049's auto-orient/crop
step (contrast normalization was found not to be available on this or any
other currently-installed image library — see `research.md`'s Phase 3 API
Verification (d) — and was dropped from scope rather than faked). This runs
*before* `src/inference/ImagePreprocessor.ts`'s existing 512×512-ceiling
resize (which uses `react-native-nitro-image` and stays exactly as-is per
Principle IV) — the two are sequenced stages, not a replacement of one by the
other. `expo-clipboard` (for T055) and `expo-audio` (for T058) were added the
same way, as their respective workstreams were implemented.

**Historical note**: this section originally described `generationConfig` as
"currently unused" and `expo-clipboard`/T055 as "unimplemented... still
pending." Both have since been implemented (T055/T056 and T090) — see below
for the current state.

**Generation config ceiling**: per `research.md`'s Phase 3 API Verification,
`GenerationConfig` on the installed `react-native-executorch` 0.9.2 exposes
only `temperature`, `topP`, `minP`, `repetitionPenalty`,
`outputTokenBatchSize`, `batchTimeInterval` — no `topK`, no `maxTokens`, no
`sequenceLength`. FR-051/FR-052 are scoped to that reality: tuning goes
through `configure({ generationConfig })` — `useInferenceEngine.ts`'s
`configureForLongResponses()` now sets both `chatConfig` and
`generationConfig` (`src/inference/GenerationTuning.ts`'s
`LOCRA_GENERATION_CONFIG`, T090), superseding the model-registry defaults
(`{temperature: 0.1, minP: 0.15, repetitionPenalty: 1.05}`) that ran before
that task landed; output-length capping goes through watching
`getGeneratedTokenCount()` (exposed on `InferenceEngineHandle`) and aborting
the request once a configured budget is hit (T092), not a config field.

**No new architectural boundary for the extraction/pinned-context work**:
the structured-extraction turn (FR-041) and pinned-context construction
(FR-044) are additional responsibility inside the existing
`src/inference/` module (a new pure `.ts` file, e.g.
`ExtractionPrompt.ts`/`ContextBuilder.ts`, to be named at implementation
time) — still zero UI imports, same Principle X boundary already
established for `InferenceQueue.ts`.

**Resumable threads (FR-045–FR-047) reuse `HistoryStore`/`historyStore`
as-is**: `QASession.turns` (already implemented, `src/types/models.ts`) is
already the full-thread record the spec calls for — no new persisted entity
is introduced. The work here is screen-level: keying a chat screen by
session id and wiring history-tap → hydrate → continue, which today's
`HistoryScreen.tsx` does not do (its cards are read-only; tapping one does
not navigate anywhere).

**Root-cause fix for T054 (FR-039/FR-040) touches, at most, three existing
files** — no new module: `src/store/inferenceStore.ts`'s
`waitForMessageHistory` (replace the fixed 250 ms race with a deterministic
wait, per `research.md`'s root-cause note), `src/navigation/AppNavigator.tsx`'s
conditional `InferenceEngineHost` mount (harden so it cannot remount
mid-app-lifetime), and `src/inference/useInferenceEngine.ts`'s
`configureForLongResponses` (confirm it truly never re-fires after the first
successful configure). See `research.md`'s root-cause note for the exact
line references informing this fix.
