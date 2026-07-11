# Contract: Active Model Selection Seam

**Feature**: 004-model-bake-off | **Date**: 2026-07-11

The internal contract for the single build-time model-selection seam (`src/model/ActiveModel.ts`) and the behavior its consumers must uphold. These are the assertions contract/unit tests verify. This is an internal module contract (the app exposes no external API for this feature).

---

## C1. `resolveActiveModel(config): ModelCandidate`

**Given** a build-time selection value, **returns** exactly one `ModelCandidate`.

| Input | Result |
|-------|--------|
| unset / undefined / empty | `LFM` candidate (`id = 'LFM2_5_VL_1_6B_QUANTIZED'`) — **default** (FR-002) |
| value selecting LFM | `LFM` candidate |
| value selecting Gemma | `Gemma` candidate (`id = 'GEMMA4_E2B_MM'`) |
| unrecognized value | `LFM` candidate (safe default) — MUST NOT throw, MUST NOT silently select Gemma (FR-002, Edge Case "Default preserved") |

**Invariants**:
- Return value is one of exactly two registered candidates (FR-001).
- Resolution is pure and deterministic for a given build value; no runtime/UI/MMKV input (FR-001, no hot-swap).
- The resolved candidate's `modelConstant` is the ExecuTorch constant (`LFM2_5_VL_1_6B_QUANTIZED` or `GEMMA4_E2B_MM`).

## C2. Inference host uses the active model (FR-003, FR-004, FR-006)

- `useInferenceEngine` calls `useLLM({ model: activeModel.modelConstant })` — exactly one `useLLM` call site remains.
- No second inference host or concurrent model path exists (single-flight preserved, Principle II).
- No explicit `configure({ generationConfig })` override is added; each model's bundled `generationConfig` is applied by `LLMController.load()` (LFM tuned config; Gemma library default).

## C3. Download/verify/readiness are model-scoped (FR-007, FR-008, FR-009)

- `MODEL_SOURCES` = the active model's `[modelSource, tokenizerSource, tokenizerConfigSource]`.
- The integrity config (`{sha256, size}`) is the active model's config (endpoint + fallback).
- **Readiness isolation (critical)**: `reconcile()` / `isReadyForInference()` MUST evaluate presence + size for the **active model's own `.pte` filename** (derived from `activeModel.modelConstant.modelSource`), not "any `.pte` present".

| Scenario | Required outcome |
|----------|------------------|
| Gemma build; only LFM `.pte` on disk | reports **not ready**; initiates Gemma download (FR-008) |
| LFM build; only Gemma `.pte` on disk | reports **not ready**; initiates LFM download (FR-008) |
| Active model's `.pte` present + size ≥ expected | reports **ready** without re-download (FR-015 coexistence) |
| Both models' `.pte` present | reports ready for the **active** model only; never deletes the other (FR-015) |
| Storage check before download | evaluated against the **active** model's size (FR-007) |
| pause / resume / cancel | operate on the active model's `sources` (FR-007) |
| active model's files fail integrity | route to existing setup/recovery; no inference on bad/foreign assets (FR-009, Principle III) |

## C4. Recorded metadata reflects the active model (FR-010, FR-011, FR-012)

- Every `ObjectiveInferenceResultRecord` has `modelId === activeModel.id` and `generationConfigId === activeModel.generationConfigId`.
- Every diagnostic export's `appInfo` carries the active model's `id` + `generationConfigId`.
- The 18-case evaluation runs unchanged (`caseSetVersion === 'cases.v1'`) on both models (FR-011).
- Two runs' result sets are structurally identical and differ only by model identity + metrics (FR-012); existing comparison tooling accepts both, extended only as needed to be model-tagged (FR-016).

## C5. Default-build regression (FR-002, SC-005)

- With no selection, every observable behavior — inference, context handling, history, diagnostics, and the evaluation suite — is identical to today's LFM app.
- LFM `modelId` recorded is byte-identical to the pre-existing literal (`'LFM2_5_VL_1_6B_QUANTIZED'`).

---

## Test surface (minimal, per spec)

Only these areas get automated tests (spec: "keep automated tests minimal and focused only on model selection, model-specific lifecycle isolation, and correct evaluation metadata"):

1. **Model selection** (C1): default→LFM, explicit LFM, explicit Gemma, unrecognized→LFM (no throw).
2. **Lifecycle isolation** (C3): LFM-on-disk does not make a Gemma build ready, and vice versa; active model's present file ⇒ ready without re-download.
3. **Evaluation metadata** (C4/C5): objective record carries the active model's `id` + `generationConfigId`; default build records the unchanged LFM literal.

Explicitly NOT added: broad model-behavior tests, Gemma output-quality tests, UI tests, or comparison-report tests.
