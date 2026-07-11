# Implementation Plan: Model Bake-off (LFM vs Gemma)

**Branch**: `004-model-bake-off` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-model-bake-off/spec.md`

## Summary

Add Gemma 4 E2B multimodal (`GEMMA4_E2B_MM`, already shipped in `react-native-executorch@0.9.2`) as a second, build-selectable VLM candidate alongside the default LFM2.5-VL-1.6B, so the same Locra pipeline can be run on either model on the same physical Android device and the 18-case quality evaluation compared side by side.

The technical approach is a **single build-time model selection seam**. Today three sites name the model directly — `useInferenceEngine` (`useLLM({ model })`), `modelStore` (`MODEL_SOURCES` + the config endpoint), and `InferenceQueue.buildObjectiveResult` (hardcoded `modelId`/`generationConfigId`). We introduce one `ActiveModel` registry that resolves the selected `ModelCandidate` from the build-time environment variable `process.env.EXPO_PUBLIC_LOCRA_VLM` (`lfm2_5_vl_1_6b` | `gemma4_e2b`; missing ⇒ LFM), and route those three sites through it. Because the ExecuTorch controller auto-applies each model's bundled `generationConfig` at load, each model runs under its own official/default recommended generation configuration for free (FR-006); we only need to *record* which one was used (FR-010). Two lifecycle correctness gaps must be closed: readiness reconciliation must key on the **selected model's specific filenames** (not "any `.pte` present") so an on-disk LFM is never mistaken for Gemma (FR-008), and per-model integrity config (sha256/size) must be selected alongside the sources.

## Technical Context

**Language/Version**: TypeScript (strict mode), React 19.2 / React Native 0.85.3 (New Architecture), Expo SDK 56

**Primary Dependencies**: `react-native-executorch@^0.9.2` (on-device inference; provides both `LFM2_5_VL_1_6B_QUANTIZED` and `GEMMA4_E2B_MM` — **no upgrade required**, FR-013 verified), `zustand`, `xstate`, `react-native-mmkv`, `@kesha-antonov/react-native-background-downloader`, `expo-file-system`

**Storage**: MMKV (sole persistence, Principle VIII) for conversations/history/diagnostics; model assets on the local filesystem under the ExecuTorch download directory

**Testing**: Jest (`jest-expo`), unit + contract + integration suites already present; new tests scoped to model selection, lifecycle isolation, and evaluation metadata only (per spec: "keep automated tests minimal")

**Target Platform**: Android only (min API 26 / effective floor Android 13, target API 35), physical device with ≥6 GB RAM. Gemma-MM uses the **Vulkan delegate** on Android; LFM-VL uses XNNPACK.

**Project Type**: Single React Native mobile app (`src/` with `model/`, `inference/`, `store/`, `evaluation/`, `screens/`)

**Performance Goals**: Not a target of this feature — the bake-off *measures* per-model latency/quality; the pipeline (prompts, context, preprocessing, output limits) is held constant so the only variable is the model.

**Constraints**: No network calls in the inference pipeline (Principle I); single-flight inference (Principle II); 512×512 preprocessing ceiling and pre-load compatibility checks (Principle IV); NDK pinned to 26.3.11579264; New Architecture always on (Principle VII); model assets for both candidates may coexist on one device under one application ID (FR-015).

**Scale/Scope**: 2 model candidates, 18 evaluation cases, 1 build-time selector. Net new code is small and concentrated in the model-selection registry plus three routing edits and per-model config.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against all eleven principles:

- **I. Privacy-First (NON-NEGOTIABLE)** — PASS. Gemma runs entirely on-device via ExecuTorch, same as LFM. No network call is added to the inference pipeline. The pre-existing model-config *metadata* fetch (sha256/size) is in the model-download layer, not the inference path, and is unchanged in nature; a parallel Gemma config file is added but introduces no new inference-path network dependency.
- **II. Single-Flight Inference Queue (NON-NEGOTIABLE)** — PASS. The single `InferenceQueue` and single `useLLM` host are preserved (FR-003, FR-004); selection changes *which* model that one host loads, never adds a second host or concurrent path.
- **III. Graceful Degradation Over Crashes** — PASS, and load-bearing here: Gemma load failures that surface through the existing runtime error path MUST use the existing `errored` state (a clean message, not a crash). Not every Vulkan/native-delegate incompatibility is guaranteed to reach that JS path, so Vulkan compatibility and the absence of native crashes MUST be verified on the physical bake-off device before official evaluation, rather than assumed (see Research Risk R1).
- **IV. Memory Safety on Constrained Hardware** — PASS. 512×512 preprocessing ceiling and pre-load device-compatibility gate are unchanged (FR-005). Only one model is loaded at a time (FR-003). Coexisting on-disk assets (~2× ~2.4 GB) are a storage, not a memory, concern and are the developer's explicit choice (FR-015).
- **V. Minimal, Readable TypeScript** — PASS. The design is one small registry + three routed call sites; no `any`, no new abstraction layers beyond the single selection seam.
- **VI. TDD for Core Systems (NON-NEGOTIABLE)** — PASS. Model-selection resolution, reconciliation isolation, and evaluation-metadata recording are model-lifecycle/inference code and get failing unit tests first.
- **VII. New Architecture Only** — PASS. No dependency change (Gemma already present in the installed version); New Architecture untouched.
- **VIII. Single Local Store** — PASS. No new persistence engine; MMKV only.
- **IX. Verify Before Assuming** — PASS, actively honored: Gemma availability, its Android delegate (Vulkan), and `generationConfig` auto-apply were verified directly against the installed `react-native-executorch@0.9.2` source during planning (see research.md). Gemma's sha256/size remain to be captured at implementation from the actual downloaded artifact.
- **X. Hard Architecture Boundaries** — PASS. Selection is resolved in the model layer and consumed through existing published interfaces (`IModelLifecycle`, the inference engine handle). Screens gain no model logic; the inference module imports no UI.
- **XI. Design Source of Truth** — PASS. No production UI, no user-facing model switch, no screen redesign (FR-001, Out of Scope). Selection is build-time only; existing setup/model copy stays model-agnostic ("your on-device AI").

**Result**: No violations. No entries required in Complexity Tracking. Gate PASSES for Phase 0.

**Post-Design re-check (after Phase 1)**: Still PASSES — the data model adds a `ModelCandidate`/`ActiveModel` registry and per-model config, routed through existing seams; no new boundary crossings, no new persistence, no inference-path network, single-flight and single-host preserved. See "Post-Design Constitution Re-Check" at the end of this plan.

## Project Structure

### Documentation (this feature)

```text
specs/004-model-bake-off/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── model-selection.contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── model/
│   ├── ActiveModel.ts             # NEW — model registry + selection from process.env.EXPO_PUBLIC_LOCRA_VLM (default LFM)
│   ├── ModelConfig.ts             # EDIT — per-model config selection (drop the single hardcoded LFM fallback)
│   ├── ModelDownloadManager.ts    # EDIT — reconcile()/readiness keyed to the selected model's filenames (FR-008)
│   ├── BackgroundDownloadFetcher.ts # EDIT (if needed) — list/verify the selected model's specific .pte, not any .pte
│   ├── ModelPresentation.ts       # (verify) — stays model-agnostic copy
│   └── DeviceCompatibility.ts     # (verify) — Vulkan risk documented, no new gate; Vulkan/native-crash-free verified on device (R1)
├── inference/
│   ├── useInferenceEngine.ts      # EDIT — useLLM({ model: ActiveModel.constant })
│   ├── InferenceQueue.ts          # EDIT — record ActiveModel.id + generationConfigId (replace hardcoded literal)
│   └── GenerationTuning.ts        # EDIT — generationConfigId derived from the active model
├── store/
│   └── modelStore.ts              # EDIT — MODEL_SOURCES + config endpoint from ActiveModel
└── evaluation/                    # (verify) — records flow through unchanged; metadata now model-correct

model-configs/
├── lfm2.5-vl-1.6b-quantized.json  # existing (sha256 + size)
└── gemma-4-e2b-multimodal.json    # NEW (Gemma vulkan .pte sha256 + size — captured at implementation)

tests/
├── unit/model/ActiveModel.test.ts             # NEW — selection resolution + default-LFM
├── unit/model/ModelDownloadManager.*.test.ts  # EDIT/NEW — reconcile isolation (LFM present ≠ Gemma ready)
└── unit/inference/InferenceQueue.test.ts       # EDIT — objective record carries active model id + config id
```

**Structure Decision**: Single mobile-app project (existing layout). The feature is a thin build-time selection seam threaded through the existing `model/`, `inference/`, and `store/` modules plus one new per-model config file; no new top-level structure is introduced.

## Complexity Tracking

> No Constitution Check violations. This section intentionally left empty.

## Post-Design Constitution Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/, quickstart.md):

- The `ModelCandidate`/`ActiveModel` registry is pure data + a resolver function in the model layer (Principle X boundary respected; Principle V minimal).
- Readiness-isolation change to `reconcile()` strengthens Principle IV/III correctness (no wrong-model readiness) and is covered by TDD (Principle VI).
- Recording model id + generation config id reuses the existing `ObjectiveInferenceResultRecord`/diagnostics shape (no schema explosion; Principle VIII/X).
- No inference-path network, single host, single flight all intact (I, II).

No new violations introduced by the design. Gate PASSES.
