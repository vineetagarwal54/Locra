# Implementation Plan: Output Quality Pipeline

**Branch**: `[002-output-quality-pipeline]` | **Date**: 2026-07-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-output-quality-pipeline/spec.md`

## Summary

Refactor Locra's answer generation into a quality-oriented pipeline that separates image perception from the user-facing answer, keeps canonical conversation state owned by Locra, sends deterministic bounded message lists through stateless ExecuTorch generation, and preserves tall/document-like image content before the 512x512 model-input ceiling. After the production pipeline can produce the final user-facing answer and expose a complete production-owned objective inference result DTO, add a lightweight dev-only evaluation recorder that consumes that DTO, accumulates evaluation runs in evaluation-only local storage, and exports contract-valid JSONL artifacts without any production inference dependency on evaluation code.

## Technical Context

**Language/Version**: TypeScript strict mode; React Native 0.85.3; Expo SDK 56; React 19.2.3; Android-only.

**Primary Dependencies**: `react-native-executorch` 0.9.2 (`useLLM`, stateless `generate(messages)`, `messageHistory` cleanup, `interrupt`); `react-native-executorch-expo-resource-fetcher` 0.9.1; `expo-image-manipulator`; `react-native-nitro-image`; Zustand; MMKV; React Navigation; Jest Expo.

**Storage**: Existing production state remains in MMKV only. Evaluation recording uses evaluation-only local storage that is separate from normal conversation history, flagging data, and production analytics. Exported evaluation artifacts are versioned local JSONL files under `quality-eval/results/`.

**Testing**: Jest + React Native Testing Library for unit/integration coverage; TypeScript and ESLint checks. Intermediate comparisons use a fixed 6-case smoke subset; final official baseline/candidate evidence uses the full 18-case set from physical Android device runs and must not be inferred from local dry-runs.

**Target Platform**: Android physical devices built through EAS/Linux CI. Local Windows native builds remain blocked by the documented NDK conflict; do not use `npx expo run:android` or local prebuild as validation for this feature.

**Project Type**: Mobile app with a dev-only evaluation recorder and local developer/tester evaluation artifacts.

**Performance Goals**: Preserve single-flight inference and current memory safety. Record perception latency, answer TTFT, answer-generation latency, total end-to-end latency, generated token count, prompt token count when available, looping/truncation status, model id, generation config id, pipeline variant, and device/build metadata for every completed objective inference result that the recorder can save/export. Improve quality against SC-001 through SC-017 without adding cloud inference or alternate models.

**Constraints**: Zero network in inference path; keep LFM2.5-VL-1.6B quantized as primary model; no cloud fallback/evaluation/OCR, user-facing model selection, document RAG, storage-management feature, fine-tuning, batch automation, or separate evaluation app. Keep the 512x512 hard model-input ceiling and existing cancellation/error/persistence/history/flagging/voice behavior. The recorder must be unavailable in release builds.

**Scale/Scope**: One production answer pipeline, one production-owned objective result record, one dev-only evaluation recorder and export path, one conversation-context policy, one image-preparation adjustment, one fixed 6-case smoke subset, and one fixed 18-case full set across six categories. Evaluation code must be removable without production breakage.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- I. Privacy-First Architecture: PASS. The plan adds no network path and explicitly keeps inference/evaluation offline.
- II. Single-Flight Inference Queue: PASS. All production inference continues through `InferenceQueue`; the recorder only consumes completed production DTOs.
- III. Graceful Degradation Over Crashes: PASS. Resume reconstruction, unclear visual evidence, cancellation, missing history, and recorder unavailability in release builds all degrade without crashing production flows.
- IV. Memory Safety on Constrained Hardware: PASS. Image preservation may change crop policy, but the final model-input ceiling remains 512x512 before tensor/model execution.
- V. Minimal, Readable TypeScript: PASS. Planned changes are focused helpers and narrow DTOs, not broad abstractions.
- VI. TDD for Core Systems: PASS WITH TASK REQUIREMENT. Any inference or preprocessing behavior changes require failing unit tests before implementation.
- VII. New Architecture Only: PASS. No new native dependency is planned.
- VIII. Single Local Store: PASS. Production persistence remains MMKV; evaluation storage is isolated from production history and removable.
- IX. Verify Before Assuming: PASS. Installed ExecuTorch 0.9.2 APIs were checked locally: `generate(messages)` is available and documented as not managing conversation context; `sendMessage`, `messageHistory`, `configure`, `interrupt`, and generation fields `temperature`, `topP`, `minP`, `repetitionPenalty` also exist; no `topK` or native max-token field.
- X. Hard Architecture Boundaries: PASS. Production screens continue to use stores/components. `useInferenceEngine.ts` remains the only sanctioned `useLLM` call site. Evaluation modules must not be imported by production screens/navigation/history.
- XI. Single Theme Source: PASS. Any dev-only recorder UI must still use `src/constants/theme.ts`, but release UI remains unchanged.

**Post-Design Recheck**: PASS. Research, data model, contracts, and quickstart keep the same constraints. No constitutional violation requires Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-output-quality-pipeline/
|-- plan.md
|-- research.md
|-- data-model.md
|-- quickstart.md
|-- contracts/
|   |-- evaluation-case.contract.md
|   |-- evaluation-isolation.contract.md
|   |-- evaluation-recorder.contract.md
|   |-- evaluation-result.contract.md
|   `-- output-pipeline.contract.md
`-- tasks.md
```

### Source Code (repository root)

```text
src/
|-- inference/
|   |-- useInferenceEngine.ts
|   |-- InferenceQueue.ts
|   |-- SystemPrompt.ts
|   |-- ExtractionPrompt.ts
|   |-- ContextBuilder.ts
|   |-- ImageEnhancer.ts
|   |-- ImagePreprocessor.ts
|   `-- GenerationTuning.ts
|-- store/
|   `-- inferenceStore.ts
|-- history/
|   `-- HistoryStore.ts
`-- evaluation/
    |-- recorder/
    |-- storage/
    `-- export/

quality-eval/
|-- README.md
|-- rubric.md
|-- cases/
|-- images/
`-- results/
```

**Structure Decision**: Keep production changes inside existing `src/inference`, `src/store`, and history boundaries. Put local evaluation assets in `quality-eval/`; any runtime recorder, run storage, and export code belongs under `src/evaluation/` and must be leaf/consumer code only. Production code may expose stable result/metric DTOs from production modules, but must not import `quality-eval/` or `src/evaluation/`. The recorder surface itself must be gated to development builds so release builds do not depend on it.

## Complexity Tracking

No constitution violations.
