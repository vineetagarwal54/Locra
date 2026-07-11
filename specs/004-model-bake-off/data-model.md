# Phase 1 Data Model: Model Bake-off (LFM vs Gemma)

**Date**: 2026-07-11 | **Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This feature is configuration-and-routing, not new persisted state. No MMKV schema changes. The "data" is a small in-code registry plus two config files and the (already-persisted) evaluation/diagnostic records whose model-identity fields become model-correct.

---

## Entity: ModelCandidate

A selectable on-device VLM. Pure, immutable, code-level (no persistence). One entry per supported model in the registry (`src/model/ActiveModel.ts`).

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Stable Locra identifier recorded in eval/diagnostics. LFM: `'LFM2_5_VL_1_6B_QUANTIZED'` (unchanged from today's literal, preserves prior eval comparability). Gemma: `'GEMMA4_E2B_MM'`. |
| `modelConstant` | ExecuTorch model object | The library constant passed to `useLLM({ model })` and used for `modelSource`/`tokenizerSource`/`tokenizerConfigSource`. LFM: `LFM2_5_VL_1_6B_QUANTIZED`; Gemma: `GEMMA4_E2B_MM`. |
| `modelName` | `string` | The library `modelConstant.modelName` (`'lfm2.5-vl-1.6b-quantized'` / `'gemma4-e2b-multimodal'`). Used for readiness filename resolution. |
| `generationConfigId` | `string` | Documented config identity recorded per run (FR-010). LFM: `'lfm2.5-vl-official-v1'` (maps to `{temperature:0.1, minP:0.15, repetitionPenalty:1.05}`). Gemma: `'gemma4-e2b-mm-library-default'` (no bundled config; native defaults). |
| `integrityConfigEndpoint` | `string` | Remote config URL for this model's `{sha256, size}` (mirrors existing LFM endpoint pattern). |
| `integrityFallback` | `{ expectedSha256: string; expectedSize: number }` | Pinned fallback when the endpoint is unreachable. LFM: existing values. Gemma: captured at implementation (research R5). |

**Validation / invariants**:
- Exactly the two candidates above exist; no third is registered (out of scope: Qwen, 450M).
- `id` is unique and stable; `LFM` `id` MUST equal the pre-existing recorded literal.
- `generationConfig` is never overridden by Locra — it is whatever `LLMController.load()` applies from `modelConstant.generationConfig` (present for LFM, absent for Gemma).

## Entity: ActiveModel (build-time selection)

The single resolved `ModelCandidate` for the current build. Resolved once from a build-time configuration value.

| Aspect | Rule |
|--------|------|
| Source | Build-time constant/flag (carrier finalized in tasks; see research R3). Never a runtime/UI value. |
| Default | Absence or unrecognized value ⇒ **LFM** (`ModelCandidate` `'LFM2_5_VL_1_6B_QUANTIZED'`). (FR-002) |
| Cardinality | Exactly one active per build; only one loaded at a time (FR-003). |
| Consumers | `useInferenceEngine` (`useLLM({ model })`), `modelStore` (`MODEL_SOURCES` + config endpoint), `InferenceQueue.buildObjectiveResult` (id + generationConfigId), `ModelConfig` (integrity selection). |

**State transitions**: none at runtime — selection is fixed for the life of the build. (Runtime hot-swap is out of scope.)

## Entity: Per-Model Integrity Config (file)

One JSON per model under `model-configs/`, providing the `.pte` integrity identity (FR-009). Shape is the existing `ModelConfig` contract.

| Field | Type | Notes |
|-------|------|-------|
| `sha256` | `string` (64 hex) | SHA-256 of the model `.pte`. |
| `size` (or `sizeBytes`) | `number` | Byte size of the model `.pte`. |

- `model-configs/lfm2.5-vl-1.6b-quantized.json` — exists (LFM XNNPACK `.pte`).
- `model-configs/gemma-4-e2b-multimodal.json` — **new** (Gemma Android Vulkan `.pte`; values captured at implementation, research R5).

## Modified records (existing shapes, model-correct values)

### ObjectiveInferenceResultRecord (`src/inference/ObjectiveInferenceResultRecord.ts`)
No shape change. Values become model-derived:
- `modelId` ← `ActiveModel.id` (was hardcoded `'LFM2_5_VL_1_6B_QUANTIZED'`).
- `generationConfigId` ← `ActiveModel.generationConfigId` (was `CURRENT_GENERATION_CONFIG_ID`).
- `pipelineVariantId`, timings, tokens, `deviceNameModel`, `appBuildId` — unchanged (pipeline held constant, FR-005/FR-006).

### Diagnostic bundle (`src/diagnostics/…`)
No shape change. Inherits the corrected `objectiveResult`; the bundle's `appInfo.modelId`/`generationConfigId` reflect `ActiveModel`. The bundle MAY additionally embed the exact `generationConfig` object for the active model (informational; FR-010 "exact configuration").

### Evaluation result (`src/evaluation/QualityEvalSchemas.ts`)
No schema change (FR-011). `EvaluationResult.modelId` / `generationConfigId` already flow from `objectiveResult`; they now carry the active model's identity. `caseSetVersion` stays `cases.v1` for both models (FR-011).

## Relationships

```
Build-time config ──resolves──▶ ActiveModel ──is one of──▶ ModelCandidate[LFM | Gemma]
                                     │
        ┌────────────────────────────┼──────────────────────────────┐
        ▼                            ▼                               ▼
 useLLM({ model })         MODEL_SOURCES + integrity config    Objective/Eval/Diagnostic
 (auto-applies                (download / verify /              records (modelId +
  generationConfig)            reconcile — filename-scoped)     generationConfigId)
```

## What is explicitly NOT modeled

- No persisted "selected model" in MMKV (selection is build-time, not runtime state).
- No cross-model comparison artifact (FR-016 — only minimal tooling model-awareness).
- No second inference host, no concurrent-model state (FR-003/FR-004).
- No per-model prompt/context/preprocessing variants (FR-005/FR-006 hold the pipeline constant).
