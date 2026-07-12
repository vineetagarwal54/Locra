# Feature Specification: Runtime Model Choice

**Feature Branch**: `004-model-bake-off`
**Status**: Implemented
**Updated**: 2026-07-11

## User Stories

### US1 - Choose a model once during onboarding (P1)

After the privacy screen and before model download, a first-time user chooses either
LFM2.5-VL 1.6B or Gemma 4 E2B Multimodal. Both options show a friendly name,
download size, and neutral description. No model download starts before selection.
The selected stable model ID is persisted in the existing MMKV store.

### US2 - Run only the selected model (P1)

Bootstrap resolves the persisted selection and initializes download, reconciliation,
integrity, storage, presentation, diagnostics, evaluation, and inference metadata from
that descriptor. With no selection, the app routes to model selection. Exactly one
inference host and one `useLLM` call site exist, and the host is not mounted until a
selection is known and verified.

### US3 - Change models safely (P2)

Settings offers a confirmed Change model action. Switching is blocked during inference
or an active/paused download. The current inference host unmounts before the persisted
selection changes. The app then enters setup for the new model and reuses its verified
files when present without redownloading. Files for the other model remain untouched.

## Functional Requirements

- **FR-001**: The app MUST offer only LFM2.5-VL 1.6B and Gemma 4 E2B Multimodal.
- **FR-002**: Model selection MUST be persisted in MMKV under the existing storage namespace.
- **FR-003**: No missing selection may silently default to a model in normal product use.
- **FR-004**: `EXPO_PUBLIC_LOCRA_VLM` MAY override selection for development only.
- **FR-005**: One global inference host and one `useLLM` call site MUST be preserved.
- **FR-006**: LFM and Gemma MUST never be loaded simultaneously.
- **FR-007**: Lifecycle and attribution MUST use the persisted/effective selected descriptor.
- **FR-008**: Reconciliation MUST match the selected model filename and ignore foreign files.
- **FR-009**: Switching MUST be confirmed and blocked during inference or download activity.
- **FR-010**: The old host MUST unmount before selection changes.
- **FR-011**: A verified target model MUST be reused without download.
- **FR-012**: Both models MUST ship through one APK and the same Android application ID.
- **FR-013**: Prompts, context, preprocessing, history, evaluation cases, and theme MUST remain unchanged.

## Success Criteria

- First launch reaches model selection before download and persists the choice.
- Only the selected model's lifecycle and inference runtime are active.
- Switching to a verified model performs zero model fetches.
- Normal testing uses one EAS build profile/APK for both choices.

## Out of Scope

- Additional models, simultaneous loading, prompt tuning, context changes, preprocessing
  changes, history changes, evaluation-case changes, or visual-system redesign.
