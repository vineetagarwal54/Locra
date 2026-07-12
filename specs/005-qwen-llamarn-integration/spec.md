# Feature Specification: Qwen3-VL Instruct via llama.rn

**Feature Branch**: `005-qwen-llamarn-integration`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "Integrate Qwen3-VL-2B-Instruct Q4_K_M with the Q8_0 projector through llama.rn into Locra. Locra currently ships only LFM2.5 through ExecuTorch. Qwen3-VL-2B-Instruct is the finalized Locra V1 model and must become the active V1 runtime after feature parity is verified. ExecuTorch remains temporarily only as a migration fallback until Qwen parity is verified, then is removed. Reuse only the proven llama.rn patterns from `spikes/qwen3vl-llamarn`; do not reuse the spike's Thinking model files or Thinking behavior. Preserve the existing UI, navigation, stores, chat history, conversation context orchestration, download UX, image flow, diagnostics, and 512 px preprocessing ceiling. Do not add normal-user model selection, runtime switching, multi-model product scenarios, Gemma, GPU acceleration, unrelated UI changes, or broader store refactoring."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Existing LFM2.5 experience remains intact during migration (Priority: P1)

A current Locra user opens the app while Qwen integration is still behind an internal development flag. Their existing LFM2.5-on-ExecuTorch experience continues unchanged: onboarding, privacy screen, download UX, chat, image Q&A, conversation history, context orchestration, diagnostics, and settings all behave as they did before this feature.

**Why this priority**: Qwen integration must not destabilize the shipping product while parity is being proven. ExecuTorch remains available only as a temporary migration fallback during this phase.

**Independent Test**: Run the existing LFM2.5 journey on a normal-user build: first launch, privacy flow, model download, text chat, image chat, multi-turn history, cancellation, diagnostics export, app restart, and settings. Confirm there is no Qwen model picker, runtime switcher, unrelated model option, or user-facing multi-model workflow.

**Acceptance Scenarios**:

1. **Given** a normal-user build, **When** a first-time user completes onboarding, **Then** the app proceeds through the existing Locra flow without exposing Qwen selection, runtime switching, unrelated model options, or multi-model choices.
2. **Given** a user with LFM2.5 already downloaded, **When** they send text and image messages, **Then** the existing chat UI, history, image flow, conversation context, diagnostics, and persistence behavior remain unchanged.
3. **Given** Qwen code is present behind an internal flag, **When** the flag is disabled, **Then** no Qwen setup, Qwen runtime behavior, Qwen diagnostics, or Qwen-specific copy is visible to a normal user.

---

### User Story 2 - Qwen reaches feature parity in the existing chat experience (Priority: P1)

A developer or internal tester enables Qwen3-VL-2B-Instruct using a temporary build-time or internal development flag and uses it inside the existing Locra chat experience. They send a text question, attach an image and ask about it, cancel a generation, resume use, and continue a multi-turn conversation whose supplied messages are the authoritative context for each generation.

**Why this priority**: Qwen3-VL-2B-Instruct is the finalized Locra V1 model. It must prove parity inside the real product surface before it replaces LFM2.5/ExecuTorch as the active V1 runtime.

**Independent Test**: Enable Qwen through the internal flag, verify the Qwen files, load Qwen, send a text prompt and observe a streamed answer, attach an image and observe an image-grounded answer, cancel a generation, then send a follow-up that depends on prior supplied messages. Confirm the experience uses the existing chat UI, stores, history, context orchestration, diagnostics, download UX, image flow, and 512 px preprocessing ceiling.

**Acceptance Scenarios**:

1. **Given** Qwen is enabled internally and its files are verified, **When** the tester sends a text prompt, **Then** a streamed answer appears in the existing chat UI and is persisted to existing chat history.
2. **Given** Qwen is loaded, **When** the tester attaches an image and asks about it, **Then** the answer reflects the image content using the existing image-selection and preprocessing flow, including the hard 512 px ceiling.
3. **Given** a Qwen conversation with prior turns, **When** the tester sends a follow-up, **Then** the generation uses the supplied message list as the authoritative context and accounts for earlier turns without depending on hidden retained native state.
4. **Given** Qwen answers, **When** output is displayed, **Then** no Thinking behavior, internal reasoning scaffolding, hidden prompts, raw model identifiers, or `<think>`-style tags are shown.
5. **Given** Qwen is selected for an internal build or startup, **When** the app process is running, **Then** only the selected runtime host is mounted and the runtime cannot switch until a new process/build starts.

---

### User Story 3 - Qwen becomes the active Locra V1 runtime after parity (Priority: P1)

After Qwen parity is verified, Locra uses Qwen3-VL-2B-Instruct as the active V1 runtime for the existing product experience. Users continue through the same UI and flows; the runtime change is not presented as model selection or runtime switching.

**Why this priority**: The finalized V1 product should have one active runtime and one product experience. Qwen is not an experimental extra model for users to choose; it is the V1 runtime once proven.

**Independent Test**: On a post-parity build, install Locra fresh and complete the same text, image, history, cancel, restart, and diagnostics journeys. Confirm Qwen is the active runtime, LFM2.5/ExecuTorch is not used for normal inference, and no model picker or runtime switcher is introduced.

**Acceptance Scenarios**:

1. **Given** Qwen parity is approved, **When** a user starts Locra, **Then** the existing product flow uses Qwen as the active V1 runtime without asking the user to choose a model.
2. **Given** Qwen is active for V1, **When** users perform text and image Q&A, **Then** the existing UI, navigation, stores, history, image flow, diagnostics, and download UX remain consistent with the pre-migration product.
3. **Given** Qwen is active for V1, **When** normal inference runs, **Then** ExecuTorch is not used as a parallel runtime, runtime switch target, or product-visible fallback.
4. **Given** ExecuTorch has been removed after parity, **When** the Android project is built on Windows, **Then** local Android builds using `npx expo run:android` are re-enabled and validated, including replacing the current blocked Android script.

---

### User Story 4 - Qwen files download, verify, and persist through existing systems (Priority: P2)

Qwen's language-model weights and multimodal projector are obtained on-device through app's existing download, reconciliation, integrity, and storage systems rather than bundled into the app package. A tester or user with verified Qwen files does not re-download them, and unrelated model files are left untouched during migration.

**Why this priority**: Reusing the existing download and storage UX keeps the migration consistent with Locra's current architecture and avoids a parallel model-management product surface.

**Independent Test**: With no Qwen files present, trigger Qwen setup and confirm both required files are fetched, independently verified, and stored in the app's writable model location; re-enter setup and confirm zero re-downloads; confirm existing LFM2.5 files remain untouched while ExecuTorch is still present as fallback.

**Acceptance Scenarios**:

1. **Given** Qwen setup starts with missing files, **When** setup runs, **Then** both the Qwen GGUF language model and Q8_0 projector are downloaded, independently integrity-checked, and stored in the app's writable model directory.
2. **Given** verified Qwen files already exist, **When** Qwen setup runs again, **Then** no model or projector download occurs.
3. **Given** LFM2.5 files exist during the fallback phase, **When** Qwen is downloaded or verified, **Then** LFM2.5 files are not modified, moved, or deleted.

---

### User Story 5 - Qwen fails gracefully and preserves single-flight safety (Priority: P2)

Only one inference may run at a time, and only one runtime may be active during migration. Loading Qwen requires any prior runtime to be fully released first. Qwen failures such as missing files, corrupt projector, incompatible device, out-of-memory, load failure, or mid-stream cancellation produce clean recoverable states rather than crashes.

**Why this priority**: Locra's memory, privacy, and graceful-degradation rules are non-negotiable. Qwen's larger runtime must obey the same safety boundaries before it can become V1.

**Independent Test**: Exercise Qwen text and image inference, cancellation, app background/foreground, corrupt file handling, missing projector handling, device compatibility rejection, and fallback-phase transition from LFM2.5 to Qwen. Confirm the single-flight queue is respected, prior runtime ownership is released before Qwen load, and no crash or leaked context occurs.

**Acceptance Scenarios**:

1. **Given** LFM2.5/ExecuTorch is active during the fallback phase, **When** Qwen is enabled for testing, **Then** the prior runtime is released before Qwen loads and the two are never resident simultaneously.
2. **Given** Qwen is generating an answer, **When** the tester cancels, **Then** generation stops cleanly, the queue releases only after cancel handling is complete, and the app remains usable.
3. **Given** a missing or corrupt Qwen model or projector file, **When** load is attempted, **Then** the user sees a clear recoverable state with no crash and no leaked native context.

---

### Edge Cases

- Qwen GGUF is present but the Q8_0 projector file is missing or corrupt: the app must report a clear, actionable error and must not leave a half-loaded context.
- The projector is present but does not match the verified Qwen model artifact: setup must fail verification before load.
- The device cannot run Qwen due to memory or unsupported architecture: compatibility is checked before load is attempted and the user is routed to a legible state.
- Qwen generation is cancelled, the app is backgrounded, or the app is closed mid-generation: generation, queue state, and history remain consistent with no duplicate or corrupted turns.
- Qwen output contains Thinking-style scaffolding or reasoning tags: the product UI must not surface them.
- Qwen is enabled internally on a build where LFM2.5/ExecuTorch fallback is still available: startup selection must mount only one runtime host for the process and must not expose runtime switching to normal users.
- Post-parity removal of ExecuTorch must not remove chat history, diagnostics history, stored user conversations, or existing non-model user data.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST integrate `Qwen3-VL-2B-Instruct` as the finalized Locra V1 on-device vision-language model using Q4_K_M language weights and the Q8_0 multimodal projector through llama.rn.
- **FR-002**: Locra's current shipping baseline MUST be treated as LFM2.5 through ExecuTorch only; the specification MUST NOT assume Gemma is integrated, selectable, downloadable, or part of the existing product.
- **FR-003**: The integration MUST reach feature parity with the current LFM2.5 product capabilities before Qwen becomes the active V1 runtime: text chat, image Q&A, streamed output, conversation context/history, cancellation, graceful error handling, single-flight execution, diagnostics continuity, download UX continuity, and local-only operation.
- **FR-004**: ExecuTorch MUST remain temporarily only as a migration fallback until Qwen parity is verified; after Qwen is approved as the active V1 runtime, ExecuTorch MUST be removed from the normal runtime path and final product scope.
- **FR-005**: The app MUST NOT add normal-user model selection, runtime switching, or multi-model product scenarios as part of this feature.
- **FR-006**: Qwen MAY initially be enabled only through a temporary build-time or internal development flag for integration and parity testing.
- **FR-007**: The integration MUST reuse the proven implementation patterns validated in `spikes/qwen3vl-llamarn` for llama.rn lifecycle, vision completion, streaming, context construction, and preprocessing, while fitting them into Locra's existing architecture.
- **FR-008**: The integration MUST use the Instruct model and MUST NOT ship, depend on, or copy the spike's Thinking model files or Thinking-specific behavior.
- **FR-009**: Qwen MUST run entirely on-device with zero network calls in the capture, preprocessing, model execution, answer generation, and persistence stages.
- **FR-010**: Qwen inference MUST run CPU-only. Its llama.rn configuration MUST set `n_gpu_layers: 0`, and projector GPU acceleration MUST be disabled.
- **FR-011**: Qwen MUST use the exact spike-validated llama.rn baseline settings unless implementation verification explicitly records a justified change: CPU-only, `n_gpu_layers: 0`, projector `use_gpu: false`, `n_ctx: 4096`, `ctx_shift: false`, `use_mlock: false`, default `n_predict: 512` with validated options `256`, `512`, and `1024`, `temperature: 0`, no explicit stop-token list configured by the spike, and no custom chat template configured by the spike.
- **FR-012**: Qwen generation MUST be stateless with respect to native retained conversation state: the supplied messages for each request are the authoritative context, and hidden runtime state MUST NOT be required to reconstruct the conversation.
- **FR-013**: Runtime selection during migration MUST be a simple build-time or internal startup selection such as `executorch` or `qwen-llamarn`; only the selected host may mount for the process, and runtime switching while the process is running MUST NOT be supported.
- **FR-014**: Qwen inference MUST run under the existing single-flight inference queue; the lock MUST be acquired before preprocessing begins and released only after the result is persisted, cancelled, or its error is fully handled.
- **FR-015**: Qwen MUST preserve the existing UI, navigation, stores, chat history, conversation context orchestration, download UX, image flow, diagnostics surfaces, and 512 px preprocessing ceiling unless a later explicit spec changes them.
- **FR-016**: Qwen's model files MUST be obtained through the existing download, reconciliation, integrity, and storage systems, stored in the app's writable model directory, and MUST NOT be bundled in the application package.
- **FR-017**: The Qwen GGUF language model and Q8_0 projector MUST be independently verified for identity and integrity before load; verification of one artifact MUST NOT imply verification of the other.
- **FR-018**: Verified Qwen files already present on device MUST be reused without re-downloading, and Qwen setup MUST NOT modify or remove LFM2.5 files during the fallback phase.
- **FR-019**: Every Qwen failure mode, including missing/corrupt files, projector mismatch, incompatible device, load failure, out-of-memory, projector initialization failure, and mid-stream cancellation, MUST produce a clean, user-legible state with no crash and no leaked native context.
- **FR-020**: Device compatibility for Qwen, including available memory and architecture support, MUST be checked before a load is attempted.
- **FR-021**: The product UI MUST NOT expose Qwen's internal inference stages, hidden prompts, intermediate perception output, raw model identifiers, developer diagnostics, or Thinking-style reasoning beyond existing approved diagnostics behavior.
- **FR-022**: Qwen `loadModel()` MUST be idempotent. Every inference request MAY call `loadModel()`, and an already-loaded verified Qwen model MUST return immediately without reload, duplicate projector initialization, or state corruption.
- **FR-023**: Follow-up/conversation status MUST NOT be used as proof that Qwen is resident; residency MUST be determined by private in-memory engine state and verified artifact readiness.
- **FR-024**: Before every Qwen generation, stale KV cache and native conversation state MUST be cleared without unloading the model, so extraction, extraction retry, visible answer, refusal retry, and later turns cannot leak native context into one another.
- **FR-025**: Output sanitization MUST be limited to a narrow defensive guard for accidental control tags. It MUST NOT hide use of the wrong model, a Thinking template, or invalid response configuration; those conditions MUST fail validation.
- **FR-026**: The supported Qwen V1 platform MUST be Android 13+ with minimum API level 33. This feature MUST NOT expand support to API 26.
- **FR-027**: EAS Build MAY remain the temporary native build path while ExecuTorch and llama.rn coexist. After ExecuTorch removal, Windows local Android builds MUST be re-enabled and validated with `npx expo run:android`, including replacing the current blocked Android script.
- **FR-028**: Post-parity removal of ExecuTorch MUST include full dependency removal, initialization-path removal, model-path/config cleanup, local-build restriction removal, and preservation of existing user data, chat history, diagnostics history, and non-model app state.
- **FR-029**: The existing aggregate `modelStore` product-facing UI contract MUST be preserved. Per-artifact Qwen model/projector state MAY exist internally in the bundle manager, but MUST NOT create a parallel product-facing store or UI state model.

### Key Entities *(include if feature involves data)*

- **Qwen model descriptor**: The stable internal identity and metadata for Qwen3-VL-2B-Instruct, including friendly V1 presentation, download size, neutral description, required file set, CPU-only runtime settings, and the llama.rn runtime it uses. This descriptor is not a normal-user model-selection entry.
- **Qwen model files**: The two on-device artifacts, consisting of the Qwen3-VL-2B-Instruct Q4_K_M GGUF language model and the Q8_0 multimodal projector. Each artifact is independently integrity-verified, stored in the app's writable model directory, never bundled, and distinct from any spike Thinking files.
- **Startup runtime selection**: A build-time or internal process-start choice of `executorch` or `qwen-llamarn` during migration. It is not persisted as product state, not user-selectable, and not switchable while the app process is running.
- **Authoritative message context**: The complete message list supplied to each Qwen generation request, including text and image references after preprocessing. This context is the source of truth for generation and must not depend on hidden native conversation state.
- **Private Qwen engine state**: In-memory native context ownership, load status, and generation status inside the selected Qwen runtime host. It is not MMKV state, not Zustand product state, and not proof of conversation context.
- **Migration and parity records**: Planning/test records that document migration phase, parity approval, and measured baselines. These are not new MMKV or Zustand product state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of existing LFM2.5 user journeys during the migration phase (onboarding, privacy, download, text chat, image chat, multi-turn history, cancellation, diagnostics, restart, and settings) behave as before, with no Qwen picker, runtime switcher, unrelated model option, or multi-model product UI.
- **SC-002**: A tester can enable Qwen through the temporary internal flag and, within the existing chat screen, receive a streamed text answer, receive an image-grounded answer, cancel generation cleanly, and complete at least a 3-turn conversation using supplied messages as authoritative context.
- **SC-003**: After parity approval, a fresh Locra V1 build uses Qwen as the active runtime for normal text and image inference without exposing model selection or runtime switching.
- **SC-004**: Qwen answers shown to users contain no internal reasoning scaffolding, hidden prompts, raw model identifiers, Thinking behavior, or `<think>`-style tags in 100% of observed responses.
- **SC-005**: Re-entering Qwen setup with verified files present triggers zero model or projector downloads, and existing LFM2.5 files remain byte-for-byte unchanged during the fallback phase.
- **SC-006**: Across a stability run covering alternating text and image requests, at least one cancel, app background/foreground, missing-file recovery, corrupt-projector recovery, and fallback-phase runtime transition, there are zero crashes, zero leaked native contexts, and no case of two runtimes resident at once.
- **SC-007**: No network activity is observed in Qwen's inference path during a full text-and-image session.
- **SC-008**: On the same validated test device and prompt/image set used by `spikes/qwen3vl-llamarn`, the integrated Qwen runtime has no unexplained regression greater than 25% from the comparable spike baselines: approximately 2.34 seconds model load, 5.33 seconds comparable runtime-level vision completion, and 35.7 tokens/second. Full Locra end-to-end vision latency, including any existing multi-stage inference pipeline, is measured separately and MUST NOT be compared directly against the spike's single comparable vision operation.
- **SC-009**: After ExecuTorch removal in the final phase, existing user conversations, diagnostics history, and non-model app state remain accessible and intact, and Windows local Android builds using `npx expo run:android` pass after the blocked Android script is replaced.

## Assumptions

- Locra currently ships only LFM2.5 through ExecuTorch. Gemma is not treated as integrated, selectable, downloadable, or part of the current product for this feature.
- "Feature parity" means Qwen3-VL-2B-Instruct matches the current LFM2.5 user-facing capabilities in Locra: text chat, image Q&A, streamed output, multi-turn context/history, cancellation, graceful error handling, single-flight execution, diagnostics continuity, download UX continuity, preserved image flow, and local-only operation.
- Qwen is the finalized Locra V1 model. It remains behind a temporary build-time or internal development flag only until parity is verified, then becomes the active V1 runtime without adding normal-user model choice.
- ExecuTorch exists only as a temporary migration fallback while Qwen parity is verified and is removed in the final phase after Qwen is active.
- The spike's validated Qwen runtime settings carry over: CPU-only, `n_gpu_layers: 0`, projector `use_gpu: false`, `n_ctx: 4096`, `ctx_shift: false`, `use_mlock: false`, default `n_predict: 512`, validated `n_predict` options `256/512/1024`, `temperature: 0`, no explicit stop-token list configured in the spike, and no custom chat template configured in the spike.
- Qwen-specific message conversion may differ from LFM2.5 when required for correctness, but changes to the validated context, sampling, stop-token, or chat-template configuration must be explicitly verified rather than assumed.
- The Instruct model files are obtained from the corresponding approved Instruct source and have different filenames and verification metadata than the Thinking files used in the spike.
- Existing UI, navigation, stores, chat history, conversation context orchestration, diagnostics, download UX, image flow, and the 512 px preprocessing ceiling remain authoritative and are not redesigned by this feature.
- Reusing the spike's proven patterns does not mean copying the standalone spike structure wholesale; Locra's existing architecture boundaries remain authoritative.

## Dependencies

- Introduces llama.rn for the Qwen runtime while ExecuTorch remains temporarily available only as a migration fallback.
- Requires React Native's New Architecture, which the app already enables and which llama.rn also requires.
- Supports Android 13+ only for Qwen V1, with minimum API level 33.
- Relies on the existing download/reconciliation/integrity/storage systems, existing chat UI and navigation, existing conversation stores/history, existing diagnostics surfaces, existing image flow, existing preprocessing ceiling, and existing single-flight inference queue.
- Qwen's native runtime and any native dependency changes must be verified against the temporary coexistence build path before implementation. EAS Build remains temporary while ExecuTorch and llama.rn coexist; after ExecuTorch removal, Windows local Android builds must be re-enabled and validated with `npx expo run:android`.
- The Qwen GGUF language model and Q8_0 projector sources, filenames, sizes, and integrity metadata must be independently established before implementation tasks finalize download and verification behavior.

## Out of Scope

- Gemma integration, Gemma selection, Gemma download behavior, or any claim that Gemma is part of the current Locra product.
- Normal-user model selection, runtime switching, multi-model chat, side-by-side comparison, or any multi-model product scenario.
- Keeping ExecuTorch as a permanent runtime after Qwen parity is approved.
- Persisted or dynamic runtime-switching state machines, including MMKV/Zustand product state for migration phases or runtime switching.
- GPU/OpenCL/Metal/Vulkan acceleration for Qwen or its projector.
- Reusing the spike's Thinking model files, Thinking chat behavior, or reasoning display.
- Unrelated UI, navigation, design-system, prompt, store, history, diagnostics, download UX, image-flow, or preprocessing refactors.
- Changing the 512 px preprocessing ceiling.
- Bundling Qwen model files in the application package.
