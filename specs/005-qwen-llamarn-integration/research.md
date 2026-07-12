# Research: Qwen3-VL Instruct via llama.rn

## Decision: Use Qwen3-VL-2B-Instruct Q4_K_M + Q8_0 projector as the V1 runtime

**Rationale**: The feature spec finalizes Qwen3-VL-2B-Instruct as Locra V1. The integration must not treat Qwen as another selectable model; it is the target runtime after parity.

**Alternatives considered**:

- Keep LFM2.5/ExecuTorch as permanent default: rejected because Qwen is the finalized V1 model.
- Add Qwen as a normal selectable model: rejected because the spec removes normal-user model selection and runtime switching.
- Include unrelated model planning: rejected because Locra's current baseline is LFM2.5 only and this feature is scoped to Qwen.

## Decision: Keep ExecuTorch only as temporary migration fallback

**Rationale**: The current product ships on LFM2.5 through ExecuTorch. Keeping it temporarily allows parity validation without destabilizing normal users. After Qwen parity approval, ExecuTorch must be removed from the normal runtime path and final product scope, including dependency removal, initialization-path removal, model-path/config cleanup, and local-build restriction removal.

**Alternatives considered**:

- Remove ExecuTorch before Qwen parity: rejected because it removes the working fallback too early.
- Keep ExecuTorch permanently: rejected because the spec says Qwen is the V1 runtime and ExecuTorch is temporary only.
- Expose runtime switching to users: rejected because it creates a multi-model product scenario outside scope.

## Decision: Use startup-only internal runtime selection, not dynamic switching

**Rationale**: The feature needs a temporary fallback while Qwen parity is verified, but it must not create a multi-model product or runtime-switching state machine. A simple build-time or internal process-start selection (`executorch` or `qwen-llamarn`) mounts only the selected host. The runtime cannot switch while the process is running.

**Alternatives considered**:

- Persist runtime selection in MMKV/Zustand: rejected because migration phase information is a planning/test concern and normal users must not see switching.
- Allow switching inside a running process: rejected because it increases native lifecycle risk and creates product/runtime complexity outside scope.
- Add user-facing model selection: rejected because Qwen is the finalized V1 runtime, not an optional model.

## Decision: Use a narrow llama.rn runtime adapter under `src/inference/llamaRn/`

**Rationale**: Locra already has an inference engine boundary and single-flight queue. A Qwen adapter can satisfy that boundary while isolating private in-memory native lifecycle, message conversion, Qwen settings, and cleanup. This preserves screens, stores, history, diagnostics, and context orchestration.

**Alternatives considered**:

- Put llama.rn calls in screens or stores: rejected by architecture boundaries.
- Rewrite the whole inference queue for multiple runtimes: rejected as broad refactoring and a multi-model scenario.
- Copy the spike app structure: rejected because the spike is standalone and uses Thinking-specific behavior.

## Decision: Reuse only proven spike patterns, not Thinking assets or behavior

**Rationale**: `spikes/qwen3vl-llamarn` validates the relevant llama.rn patterns: single native context ownership, load/unload sequencing, CPU-only config, projector init, local image URI multimodal messages, streaming/completion, and image verification/downscale. Its model files and response handling are for the Thinking variant and must not be reused.

**Alternatives considered**:

- Copy `fullRawResponse` and rely on output sanitization to hide `<think>` tags: rejected because that would hide a wrong model/template/configuration rather than fail validation.
- Reuse spike model filenames: rejected because Instruct model and projector files have separate identity and verification metadata.
- Reuse spike UI: rejected because Locra must preserve its existing UI.

## Decision: Use the exact spike-validated Qwen runtime settings as the baseline

**Rationale**: The spike already validated a specific llama.rn configuration. Locra should carry that baseline forward instead of leaving parameters undecided: CPU-only, `n_gpu_layers: 0`, projector `use_gpu: false`, `n_ctx: 4096`, `ctx_shift: false`, `use_mlock: false`, default `n_predict: 512`, selectable validated `n_predict` values `256`, `512`, and `1024`, and `temperature: 0`. The spike configured no explicit stop-token list and no custom chat template; implementation must not invent either without separate verification.

**Alternatives considered**:

- Enable GPU/OpenCL for speed: rejected because it is explicitly out of scope and was unstable in the spike.
- Leave context/sampling/chat-template settings undecided: rejected because the spike already provides the validated baseline.
- Make GPU or sampling a user setting: rejected because runtime/performance modes are outside scope and risk crashes.

## Decision: Treat supplied messages as authoritative context for each generation

**Rationale**: Locra already owns conversation context, history, and bounded context construction. Qwen generation must be stateless with respect to hidden native conversation state so app history remains the source of truth and hydration/retry behavior stays deterministic.

**Alternatives considered**:

- Use llama.rn retained native chat history: rejected because it creates a second source of truth and complicates hydration/cancel/retry.
- Store Qwen-specific context separately: rejected as a parallel history/store refactor.

## Decision: Make `loadModel()` idempotent and clear native state per request

**Rationale**: Every request path may call `loadModel()` safely. If Qwen is already loaded, it returns immediately without reloading or reinitializing the projector. Follow-up status is not proof of residency; the private engine checks its in-memory context. Before each generation, stale KV/native conversation state is cleared without unloading the model so extraction, extraction retry, visible answer, refusal retry, and later turns cannot leak context into one another.

**Alternatives considered**:

- Load only once based on conversation/follow-up status: rejected because conversation state and model residency are different concerns.
- Unload/reload before every generation: rejected because it would regress load time and user experience.
- Trust native retained chat state: rejected because the supplied message list must be the only authoritative context.

## Decision: Preserve existing image preprocessing and add only Qwen-specific verification at the runtime boundary

**Rationale**: The 512 px ceiling is non-negotiable. The spike confirms that verified, resized local image files are important for llama.rn vision stability. Locra should keep `prepareImageForInference` and add runtime-boundary checks that the file handed to llama.rn exists, is readable, and is the expected processed file.

**Alternatives considered**:

- Replace Locra preprocessing with spike preprocessing wholesale: rejected because Locra's current image flow and enhancement/ceiling pipeline must be preserved.
- Increase image size for Qwen: rejected by the hard 512 px ceiling.

## Decision: Verify Qwen GGUF and projector independently

**Rationale**: The model and projector are separate artifacts. The app must not infer projector validity from model validity or vice versa. Each file needs independent filename, expected size, digest, verification timestamp, and error state inside the bundle manager. The existing aggregate `modelStore` UI contract remains the product-facing state.

**Alternatives considered**:

- Product-facing per-artifact store: rejected because it creates a parallel UI/store model outside scope.
- Single internal "Qwen verified" flag: rejected because it can mask a corrupt or mismatched projector.
- Bundle artifacts in the APK: rejected by the spec and existing download UX.

## Decision: Use physical-device parity gates against the validated spike baseline

**Rationale**: Emulator results are not authoritative for model load, vision latency, tokens/sec, memory, crash, or thermal behavior. The plan uses the same device and prompt/image set as the spike baseline: about 2.34s model load, 5.33s comparable runtime-level vision completion, and 35.7 tok/s, with no unexplained regression greater than 25%. Full Locra end-to-end vision latency must be measured separately because Locra may perform multiple inference stages.

**Alternatives considered**:

- Unit-test-only acceptance: rejected because native runtime performance and leaks require device validation.
- Compare against arbitrary devices: rejected because device differences would make the 25% threshold meaningless.
- Compare full Locra multi-stage latency directly to the spike's single vision operation: rejected because the operations are not equivalent.

## Decision: Update governance before installing/removing native runtime dependencies

**Rationale**: The current constitution technology constraints still call ExecuTorch the sole on-device inference runtime. This feature intentionally supersedes that. Implementation should include a governance/constraint update before native dependency installation/removal tasks proceed.

**Alternatives considered**:

- Ignore the constitution conflict: rejected because Spec Kit plans must surface governance violations.
- Delay the conflict until code review: rejected because native dependency choices affect planning, build strategy, and tasks.

## Decision: Support Android 13+ / API 33 minimum for Qwen V1

**Rationale**: Qwen V1 support is scoped to Android 13+ with minimum API level 33. Planning artifacts must not expand support to API 26 for this feature.

**Alternatives considered**:

- Preserve API 26 as the Qwen V1 minimum: rejected by the corrected feature scope.
- Leave platform minimum to implementation: rejected because native build and device validation planning depends on the supported platform.

## Decision: Treat EAS Build as temporary during runtime coexistence, then restore Windows local Android builds

**Rationale**: Local Windows Android builds are blocked while ExecuTorch and llama.rn coexist. EAS Build remains the temporary path during coexistence only. After ExecuTorch is removed, the final migration phase must re-enable and validate Windows local Android builds with `npx expo run:android`, including replacing the current blocked Android script.

**Alternatives considered**:

- Keep EAS Build as the permanent path: rejected because the local-build restriction is tied to the temporary ExecuTorch coexistence conflict.
- Run `npx expo run:android` locally during coexistence: rejected while the known native conflict remains.
- Validate native changes only through unit tests: rejected because llama.rn requires a native build and physical-device validation.
