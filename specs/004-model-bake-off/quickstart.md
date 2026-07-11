# Quickstart: Model Bake-off (LFM vs Gemma)

**Feature**: 004-model-bake-off | **Date**: 2026-07-11

How to validate the feature end to end: produce an LFM build and a Gemma build, run the identical 18-case evaluation on the same physical Android device, and confirm the exported results are comparable and correctly model-tagged. See [contracts/model-selection.contract.md](./contracts/model-selection.contract.md) for the behavioral assertions and [data-model.md](./data-model.md) for the registry shape.

## Prerequisites

- A physical Android device with ≥6 GB RAM, Android 13+, and **Vulkan delegate support** (required for Gemma-MM — see research.md R1). Emulators are not authoritative.
- Dev client / release build toolchain already used for Locra (NDK 26.3.11579264, New Architecture).
- Enough free storage for both models if you keep them side by side (~2× ~2.4 GB; coexistence per FR-015).
- `react-native-executorch@^0.9.2` already installed (Gemma present — no upgrade; research.md R0).

## Automated checks (run first)

```bash
npm run type-check
npm run lint
npm test
```

Expected: green, including the new/edited tests for model selection, reconciliation isolation, and evaluation metadata (contract §Test surface). These prove the seam without a device.

## Build & run each model

Build selection is a build-time value (default = LFM; final carrier defined in tasks.md). Conceptually:

- **LFM build (default)**: build with no model selection → app runs LFM2.5-VL-1.6B, identical to today.
- **Gemma build**: build with the Gemma selection value → app runs Gemma 4 E2B multimodal.

For each build, on the same device:

1. Launch; complete model download → integrity verification → readiness for the selected model.
2. Capture an image, ask a question, confirm a streamed answer with no crash (SC-002).
3. Confirm only the selected model is active (diagnostics/eval metadata will show its id).

## Validate lifecycle isolation (FR-008 — the trust-critical check)

On one device:

1. Install the **LFM** build; let it fully download + verify LFM.
2. Install the **Gemma** build over it (same application ID, no data clear — FR-015).
3. Confirm the app reports **not ready** and downloads Gemma (it must NOT report ready off the on-disk LFM files), and does not delete the LFM assets.
4. Reinstall the **LFM** build; confirm it reports **ready immediately** off the still-present LFM files (no re-download — FR-015 coexistence).

Expected: zero false-ready events across switches (SC-004).

## Run the evaluation on both builds

1. On the **LFM** build, run the existing 18-case quality evaluation; export results.
2. On the **Gemma** build, run the **same** 18-case suite (`caseSetVersion` = `cases.v1`, unchanged — FR-011); export results.
3. Inspect each exported record: `modelId` and `generationConfigId` reflect the model that produced it (LFM → `LFM2_5_VL_1_6B_QUANTIZED` / `lfm2.5-vl-official-v1`; Gemma → `GEMMA4_E2B_MM` / `gemma4-e2b-mm-library-default`) — FR-010.

## Compare

Use the existing quality-eval comparison tooling (extended only to accept two model-tagged result sets — FR-016) to place the two sets side by side per `caseId` and identify the better model on the 18 cases (SC-006). No new report is produced.

## Expected outcomes (success criteria mapping)

| Check | Criterion |
|-------|-----------|
| Two builds from one source, no pipeline/prompt edits | SC-001 |
| Gemma build completes download→verify→load→answer, no crash | SC-002 |
| Same 18 cases both builds; 100% records correctly model-tagged | SC-003 |
| Zero false-ready events on build switch | SC-004 |
| Default build reproduces today's LFM behavior | SC-005 |
| Two result sets comparable via existing tooling; winner identifiable | SC-006 |

## Notes / known constraints

- **Gemma sha256/size**: release-mode Gemma integrity verification requires the pinned values in `model-configs/gemma-4-e2b-multimodal.json` (captured at implementation, research.md R5). Dev builds skip verification via the existing `__DEV__` bypass, so bring-up is not blocked.
- **Vulkan**: if the test device lacks Vulkan support, the Gemma load fails gracefully to an error state (Principle III) rather than crashing — pick a Vulkan-capable device for a valid comparison.
- Do not add model-specific prompt/generation tuning (FR-006) — each model uses its own official/default config automatically.
