# Implementation Audit: Qwen3-VL Instruct via llama.rn

**Audited**: 2026-07-11  
**Scope**: T001-T005, before runtime-boundary implementation

## Current Locra composition

- `index.ts` initializes ExecuTorch with `ExpoResourceFetcher`.
- `src/navigation/AppNavigator.tsx` is the runtime composition root. It mounts one
  `InferenceEngineHost` after model setup is ready.
- `src/components/InferenceEngineHost.tsx` currently calls the sole
  ExecuTorch-backed hook and registers its plain handle with `inferenceStore`.
- `src/inference/useInferenceEngine.ts` is the only current `useLLM` call site.
  It passes complete `ModelRequestMessage[]` values to `generate`, clears managed
  ExecuTorch history before generation, exposes cumulative response/token
  metrics, and forwards cancellation to `interrupt()`.
- `src/store/inferenceStore.ts` adapts that handle to the runtime-neutral calls
  consumed by `InferenceQueue`: load readiness, normalized message generation,
  cumulative streaming, cancellation, and metrics.
- `src/inference/InferenceQueue.ts` owns the single-flight lifecycle and the
  existing two-stage image path. It acquires the shared activity lock before
  preprocessing and releases it only after success, cancellation, or failure.
- Diagnostics are assembled through the existing inference metrics/trace and
  diagnostics services. Qwen must feed those existing surfaces rather than add a
  parallel diagnostics system.

## Current model lifecycle and persistence

- `src/store/modelStore.ts` is the product-facing aggregate model lifecycle
  contract and composes `ModelDownloadManager` with
  `BackgroundDownloadFetcher`.
- `src/model/ModelDownloadManager.ts` currently assumes the first source is one
  `.pte` model and verifies only that selected file.
- `src/model/BackgroundDownloadFetcher.ts` currently derives destinations using
  the ExecuTorch directory resolver and filters downloaded models to `.pte`.
- `src/model/ActiveModel.ts`, `ModelConfig.ts`, and `ModelPresentation.ts` carry
  current runtime/model metadata. `ActiveModel.ts` currently also contains Gemma
  product metadata; Gemma is outside Spec 005 and must not be used as a Qwen
  migration pattern.
- MMKV keys affecting model migration include `model:selected-id` and existing
  model download/readiness metadata composed by `modelStore`. Old LFM selection
  or downloaded flags cannot establish Qwen readiness.
- Conversation/history data is owned by the existing conversation and history
  stores; drafts and image attachments remain in the existing conversation
  flow. Diagnostics traces/settings use their existing stores and keys. None of
  these may be cleared or reshaped by model migration.
- Existing LFM files must remain untouched while ExecuTorch is selected and
  until Qwen parity is approved and the fallback phase ends.

## Real-file mapping for proposed abstractions

| Planned responsibility | Actual repository target |
|---|---|
| Runtime contract | Extract the existing `InferenceEngineHandle` from `src/inference/useInferenceEngine.ts`; move the existing queue adapter contracts from `src/inference/InferenceQueue.ts` into the same runtime-neutral contract module. Do not create another interface. |
| ExecuTorch adapter | Move the existing hook implementation to `src/inference/executorch/useExecutorchInferenceEngine.ts`. |
| Runtime host selection | Split the existing `src/components/InferenceEngineHost.tsx`; keep `src/navigation/AppNavigator.tsx` as the real parent composition root. |
| Startup selection | Add a module-evaluated, process-locked internal selection. It is not Zustand/MMKV state and has no setter. |
| Model bundle | Generalize the existing `ModelDownloadManager`, `BackgroundDownloadFetcher`, and aggregate `modelStore`; do not add a product-facing bundle store. |
| Compatibility | Extend `src/model/DeviceCompatibility.ts`; do not add a Qwen-only compatibility subsystem. |

If a later planned file or component does not exist, implementation must first
inspect the repository and update the task to target the real composition root.
It must not create a parallel subsystem merely to match a planning filename.

## Thinking spike evidence (patterns only)

The spike uses `Qwen3VL-2B-Thinking-Q4_K_M.gguf` and
`mmproj-Qwen3VL-2B-Thinking-Q8_0.gguf`. Those files, Thinking response behavior,
`reasoning_format: 'none'`, and `fullRawResponse()` are explicitly invalid for
the Instruct integration.

- Tested dependency: `llama.rn` `^0.12.5` in the spike manifest. Spec 005 must
  pin the exact tested version `0.12.5`, not resolve a newer compatible release.
- Load: `initLlama({ model, n_ctx: 4096, n_gpu_layers: 0, ctx_shift: false,
  use_mlock: false }, onProgress)`.
- Projector: `context.initMultimodal({ path, use_gpu: false })`, followed by
  `isMultimodalEnabled()` and `getMultimodalSupport()` verification.
- Generation: `context.completion(...)` with cumulative/native completion
  result, `n_predict` default `512` (validated options `256`, `512`, `1024`) and
  `temperature: 0`. The spike specifies no stop-token list and no custom chat
  template.
- Vision messages use local `image_url` content alongside text; JavaScript does
  not base64-encode the image.
- Reset/cancellation must use the llama.rn 0.12.5 context APIs verified during
  Qwen adapter implementation. The spike itself has a single-operation `busy`
  guard but does not expose a cancellation UI API in `llamaSpike.ts`; do not
  claim otherwise.
- Release order is projector release (`releaseMultimodal`) before context
  release (`release`), with `releaseAllLlama` as teardown cleanup.
- Proven preprocessing patterns are local-file existence/readability checks,
  non-zero size/dimensions, a 512 px longest-edge ceiling, processed-file
  re-verification immediately before inference, and scoped temp cleanup. Locra
  retains its existing preprocessing implementation and adopts only the
  runtime-boundary readability check in a later phase.

## Approved Qwen3-VL-2B-Instruct artifacts

Approved source: the model-author repository
`Qwen/Qwen3-VL-2B-Instruct-GGUF` on Hugging Face, pinned to repository commit
`52d6c8ffea26cc873ac5ad116f8631268d7eb503` as reported by the resolve endpoint.

| Artifact | Filename | Resolve URL | Bytes | SHA-256 |
|---|---|---|---:|---|
| Language model, Q4_K_M | `Qwen3VL-2B-Instruct-Q4_K_M.gguf` | `https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/52d6c8ffea26cc873ac5ad116f8631268d7eb503/Qwen3VL-2B-Instruct-Q4_K_M.gguf` | 1,107,409,952 | `089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae` |
| Multimodal projector, Q8_0 | `mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf` | `https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/52d6c8ffea26cc873ac5ad116f8631268d7eb503/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf` | 445,053,216 | `f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82` |

The Hugging Face file pages and resolve headers independently report these
digests and exact byte sizes. Readiness must match both exact descriptors;
neither a Thinking file nor an arbitrary `.gguf` is acceptable.

## Build and final-removal coupling

- During coexistence, EAS remains the native build path. The current local
  Android command intentionally invokes `scripts/blocked-local-android.js`.
- Final migration must remove `initExecutorch`, both ExecuTorch packages and
  Expo/native configuration, the ExecuTorch resource fetcher and host/hook,
  LFM constants/paths, `.pte` and ExecuTorch-directory assumptions (including
  `BackgroundDownloadFetcher`), and ExecuTorch-specific download composition.
- Only after that removal may `scripts/blocked-local-android.js` be deleted and
  the package Android command restored to `expo run:android` for Windows
  validation.

