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
Native **0.81–0.85** (NOT 0.76 as originally stated — see `research.md`
Flagged Risk 1; ExecuTorch's own compatibility table excludes RN ≤0.80).
New Architecture mandatory (constitution Principle VII; also an ExecuTorch
hard requirement independent of the constitution).

**Primary Dependencies**: `react-native-executorch` (`useLLM` hook,
`LFM2_5_VL_1_6B_QUANTIZED` model constant — see `research.md` for why not
the deprecated `LFM2_VL_1_6B_QUANTIZED` alias named in the feature input),
`react-native-executorch-expo-resource-fetcher` + `expo-file-system` +
`expo-asset` (required companion packages, not optional — `initExecutorch`
throws without a registered resource fetcher adapter), Expo Dev Client
(custom build, not Expo Go), React Native Vision Camera v5, Zustand
(inference/model/history stores), MMKV (all persistence), React Navigation,
React Native Reanimated.

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
real latency/memory behavior).

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
