# Data Model: Qwen3-VL Instruct via llama.rn

## QwenModelDescriptor

Represents Qwen as Locra's internal V1 runtime descriptor. It is not a normal-user model-selection entry and does not create a parallel product-facing model store.

**Fields**

- `id`: fixed internal id, e.g. `QWEN3_VL_2B_INSTRUCT_Q4_K_M`.
- `runtime`: fixed value `llama.rn`.
- `displayName`: user-safe V1 presentation string.
- `description`: neutral local model description.
- `enabledBy`: `internal_flag` during migration, `default_v1` after parity.
- `requiredArtifacts`: references to `QwenArtifactDescriptor` entries for GGUF and projector.
- `runtimeConfig`: reference to `QwenRuntimeConfig`.

**Validation rules**

- Must not include unrelated model metadata.
- Must not appear as a normal-user selectable option.
- Must resolve to Qwen only after parity approval in V1 builds.

## QwenArtifactDescriptor

Describes one required Qwen file.

**Fields**

- `artifactId`: `qwen_language_model` or `qwen_multimodal_projector`.
- `fileName`: expected local filename.
- `kind`: `language_gguf` or `multimodal_projector`.
- `quantization`: `Q4_K_M` for language model, `Q8_0` for projector.
- `sourceUri`: download source used by the existing download system.
- `expectedSha256`: pinned digest.
- `expectedSizeBytes`: pinned byte size.
- `storagePath`: app writable model-directory path after download.

**Validation rules**

- GGUF and projector must be verified independently.
- Thinking filenames and digests are invalid for this feature.
- File must not be loaded if digest or size mismatches.
- Verification of one artifact must not imply verification of the other.

## QwenArtifactState

Tracks local state for each artifact inside the internal Qwen bundle manager. This state is internal bundle-management detail; the existing aggregate `modelStore` UI contract remains the product-facing state.

**Fields**

- `artifactId`: links to `QwenArtifactDescriptor`.
- `downloadStatus`: `not_started`, `downloading`, `paused`, `downloaded`, or `failed`.
- `downloadProgress`: number from `0` to `1`.
- `integrityVerified`: boolean.
- `lastVerifiedAt`: timestamp or `null`.
- `error`: user-legible error string or `null`.

**State transitions**

```text
not_started -> downloading -> downloaded
not_started -> downloading -> failed
downloaded -> failed        # digest/size mismatch
failed -> downloading       # clean retry
downloading -> paused -> downloading
```

**Validation rules**

- `integrityVerified` can be true only when local file exists, size matches, and digest matches.
- Readiness is represented by `downloadStatus: downloaded` plus `integrityVerified: true`; there is no separate `verified` download status.
- Failed integrity must not leave a corrupt file treated as reusable.
- Existing LFM2.5 files must not be modified during Qwen verification.
- Per-artifact state must not create a new product-facing Zustand store or alter the existing aggregate `modelStore` UI contract.

## QwenRuntimeConfig

Captures the exact spike-validated Qwen llama.rn baseline configuration.

**Fields**

- `nCtx`: fixed `4096`.
- `nGpuLayers`: fixed `0`.
- `projectorUseGpu`: fixed `false`.
- `ctxShift`: fixed `false`.
- `useMlock`: fixed `false`.
- `nPredictDefault`: fixed `512`.
- `nPredictOptions`: fixed `[256, 512, 1024]`.
- `temperature`: fixed `0`.
- `stopTokens`: empty list unless separately verified; the spike configured no explicit stop-token list.
- `chatTemplatePolicy`: no custom chat template configured by the spike; use llama.rn/model default unless implementation verification proves Qwen Instruct requires an explicit template.

**Validation rules**

- `nGpuLayers` must equal `0`.
- `projectorUseGpu` must equal `false`.
- Settings must match the spike baseline unless a later verification record explicitly justifies a change.
- No setting may enable Thinking behavior or reveal hidden reasoning.

## AuthoritativeMessageContext

The full context supplied to a Qwen generation request.

**Fields**

- `conversationId`: current conversation id.
- `messages`: ordered Locra conversation messages included in the request.
- `mediaEvidence`: bounded image evidence from existing context orchestration.
- `importantFacts`: existing context-memory facts.
- `olderSummary`: optional existing summary for older context.
- `currentUserMessage`: text and optional image reference for the current turn.
- `budget`: context budget metadata.

**Validation rules**

- This context is authoritative for generation.
- Hidden native llama.rn conversation state must not be required.
- Image entries must reference preprocessed, local, readable files.
- Existing context orchestration remains the source of truth.

## StartupRuntimeSelection

Build-time or process-start selection of the runtime host.

**Fields**

- `selectedHost`: `executorch` or `qwen-llamarn`.
- `source`: build-time flag or internal startup configuration.
- `processLocked`: fixed `true`.

**Validation rules**

- This is not persisted as product state.
- This is not exposed to normal users.
- Only the selected host may mount for the process.
- Runtime switching while the process is running is not supported.

## QwenRuntimeState

Private in-memory engine state for the selected Qwen host. This is not MMKV state, not Zustand product state, and not used as authoritative conversation context.

**Fields**

- `status`: `unloaded`, `loading`, `loaded`, `generating`, `cancelling`, `errored`, or `releasing`.
- `loadedAt`: timestamp or `null`.
- `loadMetrics`: load time and native context metadata safe for diagnostics.
- `multimodalEnabled`: boolean.
- `multimodalVision`: boolean.
- `error`: user-legible error or `null`.

**State transitions**

```text
unloaded -> loading -> loaded -> generating -> loaded
loaded -> releasing -> unloaded
loading -> errored -> releasing -> unloaded
generating -> cancelling -> loaded
generating -> errored -> releasing -> unloaded
```

**Validation rules**

- Only one runtime may be loaded at a time.
- Only the selected startup host may own runtime state in a process.
- Projector init failure must not leave a half-loaded multimodal context.
- Release must attempt projector release before context release.
- `loadModel()` is idempotent; an already-loaded model returns immediately.
- Follow-up/conversation status is not proof that the model is resident.
- Stale KV/native conversation state is cleared before every generation without unloading the model.

## MigrationPlanRecord

Planning/test record for migration phase. This is documentation/test evidence, not product state.

**Fields**

- `phase`: `lfm_default_qwen_internal`, `qwen_internal_validated`, or `qwen_only`.
- `qwenParityApproved`: boolean.
- `fallbackAvailable`: boolean.
- `localWindowsBuildRestored`: boolean, true only after ExecuTorch removal and `npx expo run:android` validation.

**Validation rules**

- Must not be represented as new MMKV/Zustand product state.
- Normal users must not see runtime switching in any phase.
- `qwen_only` requires full ExecuTorch dependency, initialization, model-path/config, and blocked-local-build restriction removal.
- User conversations, diagnostics, and non-model app state must survive phase transitions.

## ParityMeasurement

Records physical-device validation against the spike baseline.

**Fields**

- `deviceId`: validated test device identifier.
- `promptSetId`: comparable prompt/image set id.
- `modelLoadMs`: measured Qwen load time.
- `runtimeVisionCompletionMs`: measured comparable runtime-level image-grounded completion time.
- `locraEndToEndVisionMs`: measured full Locra image request wall time, including any multi-stage inference pipeline.
- `tokensPerSecond`: measured generation throughput.
- `baselineModelLoadMs`: about `2340`.
- `baselineRuntimeVisionCompletionMs`: about `5330`.
- `baselineTokensPerSecond`: about `35.7`.
- `regressionPercent`: calculated per metric.
- `acceptedExplanation`: explanation if a metric regresses more than 25%, otherwise `null`.

**Validation rules**

- Must be collected on the same validated device and comparable prompt/image set.
- Regression greater than 25% for comparable runtime-level load, vision completion, or tok/s requires a documented explanation and explicit acceptance.
- Full Locra end-to-end vision latency is measured separately and must not be directly compared to the spike's single comparable vision operation.
- App-level overhead must identify duplicate preprocessing, avoidable reloads, or extra generation passes.
