# Feature Specification: Model Bake-off (LFM vs Gemma)

**Feature Branch**: `004-model-bake-off`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "Create Feature 004: Model Bake-off. Locra currently uses LFM2.5-VL-1.6B as its only VLM. I want to add Gemma 4 E2B multimodal as a second model candidate so I can fairly compare both models on the same physical Android device... Success means I can create one LFM build and one Gemma build, run the same evaluation cases on the same Android device, export comparable results, and confidently determine which model is a better fit for Locra."

## Clarifications

### Session 2026-07-11

- Q: On a single device, how should a build treat the *other* (non-selected) model's on-disk files when switching between LFM and Gemma builds? → A: Coexistence — both models' files may remain; a build never deletes the other model's assets, and switching back to an already-downloaded model never re-downloads it.
- Q: Is producing a cross-model comparison a deliverable of this feature, or only the comparable data? → A: Minimal tooling extension — no new report; the existing quality-eval comparison tooling is extended only as far as needed to accept two model-tagged result sets if it currently assumes a single model.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build Locra with either model, LFM stays default (Priority: P1)

As the Locra developer, I select which vision-language model a build targets — LFM2.5-VL-1.6B or Gemma 4 E2B multimodal — through build-time configuration rather than any in-app control. A build with no explicit selection uses LFM, exactly as today. The selected model then powers the entire Locra experience: capturing an image, asking a question, and receiving an answer, with nothing else in the app changed.

**Why this priority**: Without the ability to produce a working Gemma build (and to keep the existing LFM build unchanged as the default), there is no bake-off at all. This is the minimum viable slice: one alternative model, fully functional end-to-end, selectable at build time.

**Independent Test**: Produce two builds from the same source — one with no model selection (expect LFM), one selecting Gemma — install each on the same physical Android device, and confirm each build downloads, loads, and answers an image question using its own model, with the default build behaving identically to today's app.

**Acceptance Scenarios**:

1. **Given** a build produced with no explicit model selection, **When** the developer runs Locra and asks a question about a captured image, **Then** Locra loads and answers using LFM2.5-VL-1.6B, identically to the current app.
2. **Given** a build produced with Gemma selected, **When** the developer runs Locra and asks a question about a captured image, **Then** Locra loads and answers using the Gemma 4 E2B multimodal model.
3. **Given** either build, **When** an inference is in progress, **Then** only one model is loaded and only one inference runs at a time (the existing single-flight behavior is preserved).
4. **Given** either build, **When** the developer inspects the app's runtime behavior, **Then** there is no production-facing UI control that switches models — selection is fixed for the life of the build.

---

### User Story 2 - Correct, isolated model lifecycle per build (Priority: P2)

As the Locra developer moving between builds on one test device, I need each build to manage only its own model. Downloading, integrity verification, readiness reconciliation, storage-space checks, and pause/resume/cancel/background downloading must all operate on the model the build selected. A build must never treat an already-present copy of the other model as its own.

**Why this priority**: A bake-off on a single device means the LFM model may already be on disk when a Gemma build is installed (and vice versa). If readiness logic confuses the two, the developer could unknowingly test the wrong model — silently invalidating the entire comparison. Trustworthy per-model lifecycle isolation is what makes the results believable.

**Independent Test**: On a device that already has the LFM model fully downloaded and verified, install a Gemma build and confirm the app reports the model as not-ready, downloads and verifies Gemma independently, and never reports readiness based on the pre-existing LFM files — then repeat in the opposite direction.

**Acceptance Scenarios**:

1. **Given** a device with LFM already downloaded and verified, **When** a Gemma build starts, **Then** the app treats Gemma as not-yet-ready and initiates the Gemma download rather than reporting ready off the LFM files.
2. **Given** a Gemma build mid-download, **When** the developer pauses, resumes, and cancels the download, **Then** each action applies to the Gemma model download and behaves as the existing lifecycle specifies.
3. **Given** either build, **When** the app checks available storage before download, **Then** the check is evaluated against the selected model's own size.
4. **Given** either build, **When** the selected model's downloaded files fail integrity verification, **Then** the app routes to its existing setup/recovery state rather than attempting inference on a corrupt or foreign model.
5. **Given** a build whose model download is running in the background, **When** the app is backgrounded and later resumed, **Then** the background download reconciles correctly for the selected model.

---

### User Story 3 - Comparable evaluation and diagnostics tagged by model (Priority: P3)

As the Locra developer running the comparison, I run the existing 18-case quality evaluation suite unchanged on each build, and every recorded evaluation result and diagnostic bundle carries the actual model identifier and generation configuration used. The two exported result sets are structurally identical and differ only by model identity and the resulting metrics, so I can lay them side by side and decide which model fits Locra better.

**Why this priority**: The purpose of the whole feature is a decision. Comparable, correctly-attributed output is what turns two working builds into an answer. It depends on Stories 1 and 2 producing valid runs, so it comes last.

**Independent Test**: Run the 18-case evaluation on the LFM build and again on the Gemma build, then confirm the exported results use the same case-set version, every record names the model actually used for its run, and the two sets can be compared field-for-field.

**Acceptance Scenarios**:

1. **Given** either build, **When** the developer runs the quality evaluation, **Then** the same 18 cases run without modification to the suite.
2. **Given** a completed evaluation run, **When** the developer inspects each result record, **Then** it reports the model identifier and generation configuration actually used for that run.
3. **Given** a completed inference on either build, **When** the developer exports a diagnostic bundle, **Then** the bundle reports the model identifier and generation configuration actually used.
4. **Given** result sets from both builds, **When** the developer compares them, **Then** the records are directly comparable (same shape, same case set) and distinguishable by model.

---

### Edge Cases

- **Both models present on disk**: If files for both LFM and Gemma exist from prior builds, the running build loads and reports readiness for only its selected model, ignoring the other. The build MUST NOT delete the other model's assets, and if the selected model is already fully present and verified, it MUST NOT re-download it (coexistence — see Clarifications 2026-07-11).
- **Foreign partial download**: If an incomplete or paused download of the non-selected model exists, the current build ignores it and does not count it toward its own readiness or resume it.
- **Different model sizes vs. storage**: If the selected model is larger than the free space on the device, the storage check (using the selected model's size) blocks download with the existing insufficient-storage flow.
- **Gemma unavailable in the installed inference library version**: If the officially supported Gemma 4 E2B multimodal configuration is not present in the currently installed React Native ExecuTorch version, this is the single documented condition under which a dependency upgrade is permitted; otherwise no upgrade is made. This must be verified before implementation (per project Principle IX, Verify Before Assuming).
- **Integrity failure after a build switch**: If a build switch leaves stale or mismatched files for the selected model, integrity verification fails and the app routes to setup/recovery rather than inferring on bad assets.
- **Default preserved**: A build that specifies no model must never silently select Gemma; the absence of a selection always means LFM.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Locra MUST support producing a build that targets exactly one of two vision-language models — LFM2.5-VL-1.6B or Gemma 4 E2B multimodal — chosen through build-time/configuration, not through any production in-app control.
- **FR-002**: LFM2.5-VL-1.6B MUST remain the default; a build that makes no explicit model selection MUST behave exactly as the current app does today.
- **FR-003**: Exactly one model MUST be active for a given build, and only one model MUST ever be loaded in memory at a time.
- **FR-004**: The existing single inference host (`useLLM`) and single-flight inference queue MUST be preserved; no second inference host or concurrent model path may be introduced.
- **FR-005**: The current ContextOrchestrator, ContextBuilder, inference pipeline, image preprocessing (including the 512×512 preprocessing ceiling), conversation handling, history, diagnostics, and evaluation behavior MUST remain unchanged regardless of the selected model.
- **FR-006**: The bake-off MUST hold the Locra pipeline constant across both models — identical prompts, context handling, preprocessing, output limits, and evaluation cases — while allowing each model to run under its own official/default recommended generation configuration rather than a single shared configuration forced onto both. The exact generation configuration each model actually used MUST be recorded in evaluation metadata (see FR-010). No experimental or model-specific prompt or parameter tuning beyond each model's official/default recommended configuration may be added.
- **FR-007**: Model downloading, integrity verification, readiness reconciliation, storage-space checks, pause/resume/cancel, and background downloading MUST operate correctly against whichever model the build selected.
- **FR-008**: Readiness logic MUST never report the selected model as ready based on files belonging to the other model; a downloaded LFM model MUST NOT be mistaken for Gemma, and vice versa.
- **FR-009**: Integrity verification MUST validate downloaded assets against the selected model's own expected identity (e.g., its own checksum and size), not a shared or hardcoded single-model value.
- **FR-010**: Every evaluation result record and every diagnostic export MUST record the model identifier and generation configuration actually used for that run.
- **FR-011**: The existing 18-case quality evaluation suite MUST run unchanged (same cases, same case-set version) against both models.
- **FR-012**: Evaluation and diagnostic outputs from the two builds MUST be structurally comparable and distinguishable by model, so results from an LFM run and a Gemma run can be placed side by side.
- **FR-013**: The Gemma integration MUST use the officially supported React Native ExecuTorch Gemma 4 E2B multimodal model configuration available in the currently installed library version. Dependencies MUST NOT be upgraded for this feature unless that configuration is unavailable in the installed version, which is the only condition permitting an upgrade.
- **FR-014**: Any change made to enable the second model MUST preserve the app's existing graceful-degradation behavior for unsupported devices, missing models, out-of-memory conditions, and cancellation.
- **FR-015**: LFM and Gemma bake-off builds MUST share the same Android application ID and storage namespace; switching models means installing the alternate build over the existing app installation without clearing app data. Both models' asset files MAY therefore coexist within that single app's storage. A build MUST NOT delete the non-selected model's assets, and when the selected model is already fully downloaded and integrity-verified, the build MUST NOT re-download it. Reclaiming space occupied by the non-selected model is out of scope; the developer manages that manually. Running the two builds side by side under separate application IDs is out of scope.
- **FR-016**: The existing quality-eval comparison tooling MUST be able to accept and compare two model-tagged result sets. If it currently assumes a single model, it MUST be extended only as far as needed to support model-tagged comparison. No new comparison report, summary artifact, or comparison UI is in scope.

### Key Entities *(include if feature involves data)*

- **Model Candidate**: A selectable vision-language model. Attributes: a stable model identifier, its downloadable source assets, its own expected integrity identity (checksum and size), and the generation configuration it runs under. Two candidates exist: LFM2.5-VL-1.6B (default) and Gemma 4 E2B multimodal.
- **Selected Model (Build Configuration)**: The single Model Candidate a given build targets, fixed at build time. Determines which assets are downloaded, verified, and loaded, and which identity appears in recorded output. Defaults to LFM when unspecified.
- **Evaluation Result Record**: An existing per-case evaluation output, now required to carry the actual model identifier and generation configuration of the run that produced it, enabling model-tagged comparison across builds.
- **Diagnostic Bundle**: An existing exported diagnostics artifact, now required to carry the actual model identifier and generation configuration of the run it describes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a single source tree, the developer can produce two builds — one targeting LFM (the default, requiring no selection) and one targeting Gemma — without editing any pipeline, prompt, context, or evaluation logic.
- **SC-002**: On a physical Android device, the Gemma build completes the full flow end to end — download, integrity verification, model load, and answering an image-based question — with zero crashes.
- **SC-003**: The same 18 evaluation cases run on both builds using the identical case-set version, and 100% of exported result records name the model actually used for their build.
- **SC-004**: When a single device is switched from one build to the other, the app produces zero false-ready events — it never reports the newly selected model as ready off the previously installed model's files, and independently downloads and verifies the newly selected model.
- **SC-005**: The default build (no model selection) reproduces today's LFM behavior with no observable change to inference, context handling, history, diagnostics, or the evaluation suite.
- **SC-006**: The developer can compare the two builds' exported result sets with the existing quality-eval comparison tooling and identify which model performs better on the 18 cases, using output that differs only by model identity and the resulting metrics.

## Assumptions

- **Selection mechanism**: "Build-time/configuration-based" selection is assumed to mean a configuration value fixed when a build is produced (e.g., a build-time constant, environment/build variable, or build profile) with no runtime or user-facing switch. The exact mechanism is an implementation decision for the planning phase.
- **Model naming**: The user's label "Gemma 4 E2B multimodal" is treated as the intended second candidate. The exact upstream model constant/identifier and its availability will be verified against the installed React Native ExecuTorch version (`react-native-executorch ^0.9.2`) during planning, per project Principle IX; the spec does not assume a specific upstream constant name.
- **Generation configuration**: The Locra pipeline, prompts, context handling, preprocessing, output limits, and evaluation cases remain identical across both models. Each model runs under its own official/default recommended generation configuration rather than being forced onto a single shared configuration; "record the generation configuration" means recording the exact configuration each model actually used, not introducing experimental or model-specific tuning beyond that official/default recommended configuration.
- **Existing lifecycle is authoritative**: The current model download/verify/readiness/storage/pause-resume-cancel/background behavior (Feature 001) is assumed correct and is extended to be model-aware, not redesigned.
- **On-device coexistence** (confirmed 2026-07-11): LFM and Gemma bake-off builds share the same Android application ID and storage namespace, so switching models means installing the alternate build over the existing app without clearing app data. Both models' asset files may therefore coexist on one device across builds. The feature never deletes the non-selected model's files, and an already-downloaded, verified selected model is never re-downloaded on switch-back. Side-by-side installs under separate application IDs are out of scope. See FR-015.
- **No shared-state migration**: Existing persisted conversations, history, and diagnostics remain valid across builds; switching the selected model does not require migrating or invalidating prior local data.
- **NDK / native constraint**: Any dependency change permitted under FR-013 must still respect the project's pinned NDK version (26.3.11579264) and New-Architecture requirement; a Gemma configuration that would violate those constraints is out of scope for this feature.

## Out of Scope

- A production model-picker UI or any user-facing model switch.
- Runtime hot-swapping between models within a running app.
- Loading or running both models simultaneously.
- Qwen integration, LFM 450M, or any model beyond the two named candidates.
- RAG or embedding changes.
- UI redesign.
- Context architecture changes (ContextOrchestrator / ContextBuilder behavior).
- Gemma-specific prompt optimization or generation tuning.
- Cloud inference of any kind.
- A new cross-model comparison report, summary artifact, or comparison UI (existing quality-eval comparison tooling is extended only as needed to accept model-tagged result sets — see FR-016).
- Side-by-side installation of the LFM and Gemma builds under separate Android application IDs (see FR-015).
