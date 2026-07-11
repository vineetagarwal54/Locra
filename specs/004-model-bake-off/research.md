# Phase 0 Research: Model Bake-off (LFM vs Gemma)

**Date**: 2026-07-11 | **Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

All findings below were verified directly against the installed `react-native-executorch@0.9.2` source in `node_modules/` and the existing Locra model/inference code, per Constitution Principle IX (Verify Before Assuming). Nothing here is assumed from memory of the library.

---

## R0. Is Gemma 4 E2B multimodal available in the installed ExecuTorch version? (FR-013 — the gating unknown)

- **Decision**: Use `GEMMA4_E2B_MM` from `react-native-executorch@0.9.2`. **No dependency upgrade.**
- **Rationale**: `node_modules/react-native-executorch/src/constants/modelUrls.ts` exports `GEMMA4_E2B_MM` with `modelName: 'gemma4-e2b-multimodal'`, `capabilities: ['vision', 'audio']`, a model source, tokenizer, and tokenizer-config source. It is the officially supported multimodal Gemma configuration in the installed version. FR-013's condition permitting an upgrade ("only if unavailable") is therefore not triggered.
- **Alternatives considered**: `GEMMA4_E2B` (text-only, no `capabilities`) — rejected, not multimodal. Upgrading the library — rejected, unnecessary and would risk the NDK-26 pin (Principle IX / Technology Constraints).

## R1. Android inference delegate for Gemma-MM (Flagged Risk)

- **Decision**: Accept that Gemma-MM runs on the **Vulkan** delegate on Android; do **not** add a Vulkan capability gate in this feature. Gemma load failures that surface through the existing runtime error path MUST use the existing `errored` state. Vulkan compatibility and the absence of native crashes MUST be verified on the physical bake-off device before official evaluation — they are not assumed.
- **Rationale**: In `modelUrls.ts`, `GEMMA4_E2B_MM.modelSource = Platform.OS === 'android' ? GEMMA4_E2B_VULKAN_MM : GEMMA4_E2B_MLX_MM`, i.e. `gemma_4_e2b_vulkan_8da4w.pte` on Android. LFM-VL by contrast uses XNNPACK (`lfm_2_5_vl_1_6b_xnnpack_8da4w.pte`). The current `DeviceCompatibility` gate only checks OS, API level (≥ Android 13), and RAM (≥6 GB) — it does not check Vulkan. A Vulkan-incapable device may fail to load Gemma. The existing `useLLM` → `InferenceQueue` error path turns a load failure that reaches JS into a clean `errored` UI state; however, not every Vulkan/native-delegate incompatibility is guaranteed to surface through that JS path (a native-layer failure could manifest differently), which is why device verification is required rather than assumed.
- **Consequence for the bake-off**: The comparison test device MUST support the Vulkan delegate, and this MUST be confirmed on that physical device — with no native crash — before any official evaluation run. This is documented in quickstart.md as a prerequisite. Adding a runtime Vulkan gate is out of scope (adds complexity for a developer-only bake-off with a known device).
- **Alternatives considered**: Adding a Vulkan-support pre-load check — rejected as scope creep for a single known test device; a JS-visible load failure already degrades to the existing errored state, and device verification covers the rest. Forcing an XNNPACK Gemma build — rejected: the library does not expose an xnnpack multimodal Gemma constant (only `GEMMA4_E2B_XNNPACK_MODEL` for the text model), so it is not an officially supported multimodal config (FR-013).

## R2. Generation configuration per model (FR-006 / FR-010)

- **Decision**: Pass the selected model constant to `useLLM`; let the ExecuTorch controller auto-apply each model's bundled `generationConfig`. Record the resulting configuration identity per model. Do not force a shared config, and do not add tuning.
- **Rationale**: `LLMController.load()` (`src/controllers/LLMController.ts`, lines ~127–131) applies `model.generationConfig` automatically when present. `LFM2_5_VL_1_6B_QUANTIZED.generationConfig = { temperature: 0.1, minP: 0.15, repetitionPenalty: 1.05 }` — its official recommended config, applied at load today. `GEMMA4_E2B_MM` has **no** `generationConfig` field, so the native/library default applies for Gemma. This is exactly the revised FR-006 intent ("each model uses its official/default recommended generation configuration") with zero tuning code. FR-010's "record the exact configuration" is met by recording a per-model `generationConfigId` that maps 1:1 to a documented config: LFM → its bundled tuned config; Gemma → "library default (no bundled config)".
- **Note**: Locra does not currently call `useLLM(...).configure(...)`, so it already relies on this auto-apply behavior for LFM. Behavior for LFM is unchanged.
- **Alternatives considered**: Forcing both models onto LFM's config for "fairness" — rejected: contradicts the corrected FR-006 and would misrepresent Gemma. Introducing a new tuned Gemma config — rejected: explicitly out of scope (no model-specific tuning).

## R3. Build-time model selection mechanism (FR-001, FR-002)

- **Decision**: Resolve the active model from the build-time environment variable `process.env.EXPO_PUBLIC_LOCRA_VLM`, exposed through a single `ActiveModel` module. Allowed values are `lfm2_5_vl_1_6b` and `gemma4_e2b`; a missing (or unrecognized) value defaults to LFM. EAS build profiles may supply this environment variable, but the application selection seam is always `EXPO_PUBLIC_LOCRA_VLM` — there is no separate committed-constant or profile-specific selection path.
- **Rationale**: The spec requires build-time/config selection with no production UI (FR-001) and LFM as the guaranteed default (FR-002). `EXPO_PUBLIC_`-prefixed env vars are inlined at build time by Expo, so the value is fixed for the life of the build (no runtime/hot-swap). A single resolver keeps the three consuming sites (`useInferenceEngine`, `modelStore`, `InferenceQueue`) trivial and testable, and makes "no selection ⇒ LFM" a single unit-tested branch.
- **Alternatives considered**: A production settings toggle — rejected (out of scope, Principle XI). Reading selection from MMKV at runtime — rejected: runtime/hot-swap is out of scope and would risk mixed-model state.

## R4. Readiness isolation with both models on disk (FR-008 — Flagged Risk)

- **Decision**: Make `reconcile()` / readiness check for the **selected model's specific files** (its `.pte` filename derived from `ActiveModel.modelSource` via `ResourceFetcherUtils.getFilenameFromUri`), not "any `.pte` present".
- **Rationale**: `ModelDownloadManager.reconcile()` calls `fetcher.listDownloadedModels()`, which returns **all** `.pte` files in the ExecuTorch directory, then checks `models[0].size >= config.expectedSize`. With both LFM and Gemma present (FR-015 coexistence), `models[0]` may be the wrong model, so a Gemma build could report ready off an LFM file (or vice versa) — exactly the FR-008 failure. Because ExecuTorch stores each file by its URL-derived filename and the two models have distinct filenames (`lfm_2_5_vl_1_6b_xnnpack_8da4w.pte` vs `gemma_4_e2b_vulkan_8da4w.pte`), filtering the listing to the selected model's filename before the size check makes readiness model-specific and deterministic.
- **Alternatives considered**: Separate download directories per model — rejected: ExecuTorch's fetcher and `useLLM` expect its single canonical directory; splitting it would fight the library. Re-hashing on every launch to disambiguate — rejected: violates the memory/startup budget (Principle IV); filename-scoped presence is sufficient and cheap.

## R5. Per-model integrity config (sha256 + size) (FR-009)

- **Decision**: Select the integrity config (`{ expectedSha256, expectedSize }`) by active model. Add `model-configs/gemma-4-e2b-multimodal.json` for the Android Vulkan Gemma `.pte`. Replace the single hardcoded LFM fallback in `ModelConfig.ts` with a per-model fallback resolved from `ActiveModel`.
- **Rationale**: `ModelConfig.ts` currently pins one LFM `expectedSha256`/`expectedSize` (and `PINNED_MODEL_SIZE_BYTES`) and fetches one LFM endpoint. FR-009 requires validating against the selected model's own identity. The Gemma values are a genuine unknown at planning time.
- **Unknown to resolve at implementation**: Gemma vulkan `.pte` sha256 and byte size. Resolution: download the artifact once (the URL is known from `GEMMA4_E2B_VULKAN_MM`) and compute sha256 + size, then pin them in the new config file — mirroring how the LFM config was produced. Until captured, the Gemma build cannot pass release-mode integrity verification (dev builds skip verification via the existing `__DEV__` bypass, so end-to-end bring-up is not blocked).
- **Alternatives considered**: Verifying the tokenizer files too — rejected: out of scope; the existing design verifies only the model `.pte`, and this feature preserves that behavior (FR-005). Skipping integrity for Gemma — rejected: FR-009 requires it for parity with LFM.

## R6. Recording model identity in evaluation & diagnostics (FR-010)

- **Decision**: Replace the hardcoded `modelId: 'LFM2_5_VL_1_6B_QUANTIZED'` and `generationConfigId: CURRENT_GENERATION_CONFIG_ID` in `InferenceQueue.buildObjectiveResult()` with values from `ActiveModel` (`id` + `generationConfigId`). Diagnostics (which already carry `objectiveResult`) inherit the corrected values; the diagnostics bundle may additionally embed the exact `generationConfig` object.
- **Rationale**: FR-010 requires the *actual* model and generation config in every eval record and diagnostic export. The existing `ObjectiveInferenceResultRecord` already has `modelId` and `generationConfigId` string fields — reusing them keeps the eval schema and `QualityEvalCompare` shape stable (FR-011/FR-012). Keeping LFM's `id` equal to the existing literal (`'LFM2_5_VL_1_6B_QUANTIZED'`) preserves comparability of any already-collected LFM eval data.
- **Alternatives considered**: Adding brand-new metadata fields — rejected: would perturb the 18-case eval schema and comparison tooling more than needed (FR-011 "unchanged").

## R7. Comparison tooling model-awareness (FR-016)

- **Decision**: Confirm/extend `QualityEvalCompare` minimally to accept two model-tagged result sets; no new report/UI.
- **Rationale**: The existing quality-eval records already carry `modelId`/`variant`; comparison keys on `caseId`. If the current tool assumes a single model or a single variant, extend only enough to group/label by model id. FR-016 forbids a new artifact.
- **Alternatives considered**: A new side-by-side report generator — rejected (out of scope, FR-016 / Out of Scope).

---

## Open unknowns carried into implementation

| Unknown | Resolution path | Blocks |
|---------|-----------------|--------|
| Gemma vulkan `.pte` sha256 + byte size (R5) | Download the known artifact once; compute sha256 + size; pin in `model-configs/gemma-4-e2b-multimodal.json` | Release-mode Gemma integrity verification only (dev bring-up unaffected) |
| ~~Exact carrier for build-time selection (R3)~~ — RESOLVED | Finalized as `process.env.EXPO_PUBLIC_LOCRA_VLM` (`lfm2_5_vl_1_6b` / `gemma4_e2b`; missing ⇒ LFM) | Nothing |
| Test device Vulkan support (R1) | Verify on the physical bake-off device during bring-up | Gemma end-to-end run on that device |

All NEEDS CLARIFICATION items from the spec are resolved or explicitly deferred to a concrete implementation step above.
