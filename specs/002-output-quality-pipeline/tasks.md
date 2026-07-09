# Tasks: Output Quality Pipeline

**Input**: Design documents from `specs/002-output-quality-pipeline/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Required for inference, preprocessing, DTO exposure, and evaluation-recorder isolation by constitution Principle VI.

**Organization**: Tasks are ordered so fixed evaluation artifacts come first, then production quality foundation, then quality-changing production pipeline work, then the production-owned objective result DTO, and only after that the dev-only evaluation recorder, run storage, export path, and smoke/full evaluation runs.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and does not depend on incomplete tasks.
- **[Story]**: Required only for user story phases.
- Every task includes a concrete file path.

## Phase 1: Setup and Fixed Evaluation Artifacts

**Purpose**: Create isolated, removable evaluation structure, schemas, and fixed cases without changing production runtime behavior.

- [X] T001 Create the isolated evaluation project directories in `quality-eval/cases/`, `quality-eval/images/`, and `quality-eval/results/`
- [X] T002 [P] Create evaluation usage documentation scaffold in `quality-eval/README.md`
- [X] T003 [P] Create the scoring rubric scaffold in `quality-eval/rubric.md`
- [X] T004 [P] Create evaluation helper module directory with a placeholder README in `src/evaluation/README.md`
- [X] T005 [P] Add evaluation schema validation tests in `tests/unit/evaluation/QualityEvalSchemas.test.ts`
- [X] T006 [P] Add tests for evaluation case-set category counts and repo-asset ratio in `tests/unit/evaluation/QualityEvalCases.test.ts`
- [X] T007 [P] Add tests for JSONL result records with optional manual scores in `tests/unit/evaluation/QualityEvalRecorder.test.ts`
- [X] T008 [P] Add tests for baseline versus candidate comparison by case id and variant in `tests/unit/evaluation/QualityEvalCompare.test.ts`
- [X] T009 [P] Add tests for required official-run metadata fields in `tests/unit/evaluation/QualityEvalSchemas.test.ts`
- [X] T010 Define evaluation case, image source, result, manual score, and run schemas in `src/evaluation/QualityEvalSchemas.ts`
- [X] T011 Implement JSONL record formatting and validation helper in `src/evaluation/QualityEvalRecorder.ts`
- [X] T012 Implement baseline versus candidate comparison helper in `src/evaluation/QualityEvalCompare.ts`
- [X] T013 Create the fixed 18-case evaluation set with six categories in `quality-eval/cases/cases.v1.json`
- [X] T014 Add repo-tracked stable image assets for the fixed evaluation set in `quality-eval/images/`
- [X] T015 Document image inventory, asset provenance, and any future manual-capture notes in `quality-eval/images/README.md`
- [X] T016 Document the 1-5 usefulness rubric and pass/fail subjective fields in `quality-eval/rubric.md`
- [X] T017 Document the evaluation workflow scaffold in `quality-eval/README.md`
- [X] T018 Add a JSONL template/example artifact in `quality-eval/results/run-template.jsonl`
- [ ] T019 Define the fixed 6-case smoke subset for intermediate comparisons in `quality-eval/cases/smoke-subset.v1.json`

**Checkpoint**: Fixed cases, schemas, and rubric exist before production quality-changing implementation begins.

---

## Phase 2: Production Quality Foundation

**Purpose**: Add shared contracts, identifiers, and non-runtime evaluation prerequisites required before production implementation.

- [X] T020 [P] Add hidden visual evidence and answer request type tests in `tests/unit/inference/OutputPipelineTypes.test.ts`
- [X] T021 [P] Add stable generation identifier tests in `tests/unit/inference/GenerationTuning.test.ts`
- [X] T022 [P] Add contract coverage for first-turn, follow-up, resume, and image-preservation behavior in `tests/contract/output-pipeline.test.ts`
- [X] T023 [P] Add contract coverage for evaluation case/result schemas in `tests/contract/quality-eval-contracts.test.ts`
- [X] T024 [P] Add production-owned objective inference result record tests in `tests/unit/inference/ObjectiveInferenceResultRecord.test.ts`
- [X] T025 Define hidden visual evidence, answer request, context mode, and pipeline variant types in `src/inference/OutputPipelineTypes.ts`
- [X] T026 Add stable pipeline variant and generation config identifiers in `src/inference/GenerationTuning.ts`
- [X] T027 Define production-owned objective inference result record types outside evaluation modules in `src/inference/ObjectiveInferenceResultRecord.ts`
- [X] T028 Verify no new native dependency is needed and record that decision in `specs/002-output-quality-pipeline/research.md`

**Checkpoint**: Shared production contracts and fixed evaluation foundations are ready.

---

## Phase 3: User Story 2 - Generation-Setting Correction (Priority: P1)

**Goal**: Stop overriding the model preset sampling configuration and keep only stable identifiers for evaluation/reporting.

**Independent Test**: Ask practical image questions and verify the runtime uses the model preset generation behavior while still reporting stable generation and pipeline identifiers.

### Tests for User Story 2A

- [X] T029 [P] [US2] Add failing tests that `useInferenceEngine` does not pass custom runtime sampling overrides to `configure` in `tests/unit/inference/useInferenceEngine.test.ts`
- [X] T030 [P] [US2] Add failing tests for generation config identifiers without runtime custom sampling variants in `tests/unit/inference/GenerationTuning.test.ts`

### Implementation for User Story 2A

- [X] T031 [US2] Update `useInferenceEngine` to stop overriding the LFM2.5-VL preset generation configuration in `src/inference/useInferenceEngine.ts`
- [X] T032 [US2] Keep only stable evaluation/config identifiers and remove runtime custom sampling variants from `src/inference/GenerationTuning.ts`

**Checkpoint**: Runtime generation settings align with the model preset before prompt and two-stage pipeline work.

---

## Phase 4: User Story 2 - Grounded Prompting (Priority: P1)

**Goal**: Make answers concise, grounded, and useful without changing the evaluation workflow yet.

**Independent Test**: Ask practical image questions and verify answers cite visible evidence, give actionable steps, and state uncertainty when needed.

### Tests for User Story 2B

- [X] T033 [P] [US2] Add failing tests for concise grounded system prompt requirements in `tests/unit/inference/SystemPrompt.test.ts`
- [X] T034 [P] [US2] Add failing tests for visible-fact versus general-knowledge answer prompt sections in `tests/unit/inference/AnswerPrompt.test.ts`
- [X] T035 [P] [US2] Add grounded practical-advice integration coverage in `tests/integration/vision-once-chat-flow.test.ts`

### Implementation for User Story 2B

- [X] T036 [US2] Replace personality-heavy persistent instructions with concise grounded instructions in `src/inference/SystemPrompt.ts`
- [X] T037 [US2] Implement user-facing answer prompt assembly with visible-facts, general-knowledge, uncertainty, and actionable-step sections in `src/inference/AnswerPrompt.ts`
- [X] T038 [US2] Preserve list-style output for explicit visible-detail requests in `src/inference/AnswerPrompt.ts`

**Checkpoint**: Prompting is grounded and useful before the two-stage first-turn pipeline is introduced.

---

## Phase 5: User Story 1 - Two-Stage First-Turn Pipeline (Priority: P1) MVP

**Goal**: First-turn image answers must answer the user's actual question, while hidden visual evidence remains internal.

**Independent Test**: Submit first-turn image questions in tests with extraction-like model output and verify the visible response is a direct answer, hidden evidence is persisted separately, and raw extraction is not shown unless explicitly requested.

### Tests for User Story 1A

- [X] T039 [P] [US1] Add failing tests for first-turn two-step request construction in `tests/unit/inference/InferenceQueue.test.ts`
- [X] T040 [P] [US1] Add failing tests that raw extraction is never user-visible after a two-stage first turn in `tests/unit/inference/InferenceQueue.test.ts`
- [X] T041 [P] [US1] Add failing tests that hidden perception is not represented as a normal conversation turn in `tests/unit/store/inferenceStore.hydration.test.ts`
- [X] T042 [P] [US1] Add failing tests that managed history represents the original user question and final user-facing answer after a two-stage turn in `tests/unit/store/inferenceStore.hydration.test.ts`
- [X] T043 [P] [US1] Add failing tests that hidden perception is not persisted as canonical conversation turns in `tests/unit/store/inferenceStore.hydration.test.ts`
- [X] T044 [P] [US1] Add failing tests for answer prompt assembly from original question plus hidden evidence in `tests/unit/inference/AnswerPrompt.test.ts`
- [X] T045 [P] [US1] Add failing tests for cancellation, parse failure, and retry/error recovery in `tests/unit/inference/InferenceQueue.test.ts`
- [X] T046 [P] [US1] Add failing integration coverage for real-answer first turns in `tests/integration/ask-flow.test.ts`

### Implementation for User Story 1A

- [X] T047 [US1] Update visual evidence prompt output to remain hidden-only in `src/inference/ExtractionPrompt.ts`
- [X] T048 [US1] Update extraction parsing to return structured hidden evidence and visible-answer-safe failure text in `src/inference/ExtractionParser.ts`
- [X] T049 [US1] Update first-turn queue flow to run hidden perception then final answer generation in `src/inference/InferenceQueue.ts`
- [X] T050 [US1] Update the engine/store bridge so hidden perception messages never become normal managed conversation history in `src/store/inferenceStore.ts`
- [X] T051 [US1] Persist the final answer and hidden evidence separately in `src/store/inferenceStore.ts`
- [X] T052 [US1] Preserve clean cancellation/error recovery across perception, parsing/retry, and final answer generation in `src/inference/InferenceQueue.ts`

**Checkpoint**: The production pipeline now produces a real user-facing first-turn answer with hidden evidence kept internal.

---

## Phase 6: User Story 1 - Objective Result DTO and Metrics (Priority: P1)

**Goal**: Expose a complete production-owned objective inference result record only after the production pipeline can produce the final user-facing answer.

**Independent Test**: Completed inferences expose a fully populated production DTO with two-stage metrics and metadata, while production inference still does not import evaluation code.

### Tests for User Story 1B

- [X] T053 [P] [US1] Add failing tests for perception latency, answer TTFT, answer-generation latency, and total end-to-end latency in `tests/unit/inference/InferenceMetrics.test.ts`
- [X] T054 [P] [US1] Add failing tests that completed inference exposes a fully populated production-owned objective result record in `tests/unit/inference/InferenceQueue.test.ts`
- [X] T055 [P] [US1] Add failing tests that device/build metadata and pipeline identifiers are included in the production DTO in `tests/unit/inference/InferenceQueue.test.ts`

### Implementation for User Story 1B

- [X] T056 [US1] Extend metrics recording for perception latency, answer TTFT, answer-generation latency, and total end-to-end latency in `src/inference/InferenceMetrics.ts`
- [X] T057 [US1] Expose the complete production-owned objective inference result record after completed inference in `src/inference/InferenceQueue.ts`
- [X] T058 [US1] Bridge the completed production DTO to a dev-only consumer path without polluting normal history in `src/store/inferenceStore.ts`

**Checkpoint**: Production can emit the neutral objective result DTO needed by evaluation without importing evaluation code.

---

## Phase 7: User Story 6 - Dev-Only Evaluation Recorder (Priority: P2)

**Goal**: Provide a lightweight dev-only recorder UI that consumes the production DTO and only asks the evaluator for subjective fields.

**Independent Test**: In a development build, the recorder auto-populates objective fields from the current production DTO, the evaluator enters only subjective fields, and the recorder is unavailable in production builds.

### Tests for User Story 6A

- [X] T059 [P] [US6] Add tests that objective fields are populated from the production result DTO in `tests/unit/evaluation/EvaluationRecorder.test.ts`
- [X] T060 [P] [US6] Add tests that subjective fields are entered separately from objective fields in `tests/unit/evaluation/EvaluationRecorder.test.ts`
- [X] T061 [P] [US6] Add tests that the recorder is unavailable in production builds in `tests/contract/evaluation-isolation.test.ts`

### Implementation for User Story 6A

- [X] T062 [US6] Implement the dev-only evaluation recorder state and field mapping in `src/evaluation/recorder/EvaluationRecorder.ts`
- [X] T063 [US6] Implement the dev-only recorder UI for current result scoring in `src/evaluation/recorder/EvaluationRecorderScreen.tsx`
- [X] T064 [US6] Gate the recorder so it is unavailable in production/release builds in `src/evaluation/recorder/RecorderAvailability.ts`

**Checkpoint**: Developers can score a completed result without manually retyping objective fields.

---

## Phase 8: User Story 6 - Local Evaluation Run Storage (Priority: P2)

**Goal**: Save scored evaluation results into isolated local run storage without touching production history.

**Independent Test**: Save Result accumulates multiple cases into one evaluation run and never writes evaluation data into normal history or flagging paths.

### Tests for User Story 6B

- [ ] T065 [P] [US6] Add tests that Save Result does not write to normal history in `tests/unit/evaluation/EvaluationRunStorage.test.ts`
- [ ] T066 [P] [US6] Add tests that multiple cases accumulate in one evaluation run in `tests/unit/evaluation/EvaluationRunStorage.test.ts`

### Implementation for User Story 6B

- [ ] T067 [US6] Implement evaluation-only run storage in `src/evaluation/storage/EvaluationRunStorage.ts`
- [ ] T068 [US6] Implement Save Result accumulation from recorder state into run storage in `src/evaluation/recorder/EvaluationRecorder.ts`
- [ ] T069 [US6] Ensure normal production history and flagging paths ignore evaluation metadata in `src/store/inferenceStore.ts`

**Checkpoint**: Saved evaluation results accumulate locally in isolated storage and stay out of production history.

---

## Phase 9: User Story 6 - JSONL Export and Isolation (Priority: P2)

**Goal**: Export one valid JSONL record per saved case and preserve removability/import boundaries.

**Independent Test**: Export Results emits contract-valid JSONL from saved runs, and production modules still do not import evaluation code.

### Tests for User Story 6C

- [ ] T070 [P] [US6] Add tests that JSONL export contains one valid record per saved case in `tests/unit/evaluation/EvaluationExport.test.ts`
- [ ] T071 [P] [US6] Add tests that exported records satisfy the evaluation result contract in `tests/unit/evaluation/EvaluationExport.test.ts`
- [ ] T072 [P] [US6] Add source-scan tests that no production module imports evaluation modules in `tests/contract/evaluation-isolation.test.ts`

### Implementation for User Story 6C

- [ ] T073 [US6] Implement Export Results JSONL generation from saved runs in `src/evaluation/export/EvaluationExport.ts`
- [ ] T074 [US6] Add evaluation isolation/removability documentation in `quality-eval/README.md`
- [ ] T075 [US6] Document recorder availability and export constraints in `specs/002-output-quality-pipeline/quickstart.md`

**Checkpoint**: Exported runs are comparison-ready and evaluation remains isolated/removable.

---

## Phase 10: User Story 5 - Initial 6-Case Smoke Evaluation (Priority: P2)

**Goal**: Use the dev-only recorder/export path for the fixed 6-case smoke subset before later context and image-preprocessing changes.

**Independent Test**: The evaluator can manually run the smoke subset through the real app and export a baseline/current smoke artifact without PC-side reconstruction.

### Tests for User Story 5A

- [ ] T076 [P] [US5] Add tests that the smoke subset file references fixed case ids from `cases.v1` in `tests/unit/evaluation/QualityEvalCases.test.ts`

### Implementation for User Story 5A

- [ ] T077 [US5] Document the fixed smoke subset used for intermediate checkpoints in `quality-eval/cases/smoke-subset.v1.json`
- [ ] T078 [US5] Run the 6-case smoke subset on the current recorder-enabled baseline and export results to `quality-eval/results/checkpoint-00-baseline-current-smoke.jsonl`
- [ ] T079 [US5] Document the smoke-run export procedure and naming conventions in `quality-eval/README.md`

**Checkpoint**: Intermediate comparisons now use the smoke subset through the dev-only recorder/export path.

---

## Phase 11: User Story 3 - Conversation Context Correction (Priority: P1)

**Goal**: Active live conversations rely on managed ExecuTorch history; resumed conversations reconstruct needed context once and then continue normally.

**Independent Test**: Active and resumed follow-ups use one canonical Locra conversation state, build explicit bounded model messages, and never combine app-built transcript replay with ExecuTorch-managed history.

### Tests for User Story 3

- [X] T080 [P] [US3] Add failing tests for canonical follow-up routing and canonical-only persistence in `tests/unit/store/inferenceStore.hydration.test.ts`
- [X] T081 [P] [US3] Add failing tests for deterministic bounded model-message assembly in `tests/unit/inference/ContextBuilder.test.ts`
- [X] T082 [P] [US3] Add failing tests for stateless ExecuTorch runtime usage in `tests/unit/inference/useInferenceEngine.test.ts`
- [X] T083 [P] [US3] Add integration coverage for active and resumed follow-up context in `tests/integration/vision-once-chat-flow.test.ts`

### Implementation for User Story 3

- [X] T084 [US3] Implement bounded canonical model-message assembly in `src/inference/ContextBuilder.ts`
- [X] T085 [US3] Refactor the ExecuTorch bridge to use stateless `generate(messages)` in `src/inference/useInferenceEngine.ts`
- [X] T086 [US3] Update inference store follow-up routing, hydration, reset behavior, and canonical-only persistence in `src/store/inferenceStore.ts`
- [X] T086a [US3] Add development-only per-stage inference tracing in `src/inference/InferenceTrace.ts` and `src/inference/InferenceQueue.ts`
- [X] T086b [US3] Simplify first-turn final answer prompt scaffolding in `src/inference/AnswerPrompt.ts`
- [ ] T087 [US3] Run the 6-case smoke subset after context correction and export results to `quality-eval/results/checkpoint-04-context-correction.jsonl`

**Checkpoint**: Multi-turn quality is corrected and can be measured with the smoke subset.

---

## Phase 12: User Story 4 - Image Preprocessing Correction (Priority: P2)

**Goal**: Tall and document-like images are preserved by default without violating the hard 512x512 ceiling.

**Independent Test**: Preprocess tall/wide test dimensions and verify aspect-ratio-only center cropping is not applied while explicit subject-region crops and the 512 ceiling still work.

### Tests for User Story 4

- [ ] T088 [P] [US4] Add failing tests that extreme aspect ratio images are preserved without default center crop in `tests/unit/inference/ImageEnhancer.test.ts`
- [ ] T089 [P] [US4] Add failing tests that explicit subject-region crops are still honored in `tests/unit/inference/ImageEnhancer.test.ts`
- [ ] T090 [P] [US4] Add failing tests that the final 512x512 ceiling remains enforced after preservation in `tests/unit/inference/ImagePreprocessor.test.ts`

### Implementation for User Story 4

- [ ] T091 [US4] Remove aspect-ratio-only center cropping from default image enhancement in `src/inference/ImageEnhancer.ts`
- [ ] T092 [US4] Preserve explicit subject-region cropping plus orientation/downscale behavior in `src/inference/ImageEnhancer.ts`
- [ ] T093 [US4] Verify the hard 512x512 model-input ceiling remains unchanged in `src/inference/ImagePreprocessor.ts`
- [ ] T094 [US4] Run the 6-case smoke subset after image preprocessing correction and export results to `quality-eval/results/checkpoint-05-image-preprocessing.jsonl`

**Checkpoint**: Document-like image preservation is corrected and measurable via the smoke subset.

---

## Phase 13: User Story 5 - Repeated Smoke Comparisons (Priority: P2)

**Goal**: Reuse the same 6-case smoke subset after isolated quality-changing phases to catch regressions with minimal manual effort.

**Independent Test**: Repeated smoke runs can be exported and compared by case id and pipeline variant after prompting, context, and image-preprocessing changes.

### Implementation for User Story 5B

- [ ] T095 [US5] Run the 6-case smoke subset after the grounded prompting and two-stage pipeline phases and export results to `quality-eval/results/checkpoint-03-two-stage-flow.jsonl`
- [ ] T096 [US5] Compare the context-correction smoke run against the earlier smoke baseline in `quality-eval/results/checkpoint-04-context-correction.md`
- [ ] T097 [US5] Compare the image-preprocessing smoke run against the earlier smoke baseline in `quality-eval/results/checkpoint-05-image-preprocessing.md`
- [ ] T098 [US5] Document repeated smoke-comparison procedure and variant naming in `quality-eval/README.md`

**Checkpoint**: The same 6 cases are reused for intermediate comparisons instead of requiring the full 18-case set after every isolated change.

---

## Phase 14: User Story 5 - Final Stabilized Candidate and Full Official Evaluation (Priority: P2)

**Goal**: Use the recorder/export path to produce final official full-set baseline/candidate artifacts and a release-quality comparison.

**Independent Test**: The full 18-case set is run manually through the real app only after the stabilized candidate pipeline and recorder/export path exist, and exported artifacts compare cleanly by case id and variant.

### Tests for User Story 5C

- [ ] T099 [P] [US5] Add tests that full comparison rejects non-official artifacts for official reporting in `tests/unit/evaluation/QualityEvalCompare.test.ts`

### Implementation for User Story 5C

- [ ] T100 [US5] Record the official full-set baseline artifact from the recorder-enabled baseline build in `quality-eval/results/baseline-current-full.jsonl`
- [ ] T101 [US5] Record the official full-set stabilized candidate artifact in `quality-eval/results/candidate-two-stage-v1.jsonl`
- [ ] T102 [US5] Add the final baseline-versus-candidate comparison summary artifact in `quality-eval/results/comparison-two-stage-v1.md`
- [ ] T103 [US5] Document the final full-set comparison and export procedure in `quality-eval/README.md`

**Checkpoint**: Final official evaluation uses the full 18-case set only after the stabilized candidate and recorder/export path exist.

---

## Phase 15: Polish and Release Gate

**Purpose**: Final validation, cleanup, and release-readiness checks across all user stories.

- [ ] T104 [P] Run and fix TypeScript validation with `npm run type-check` and record the result in `specs/002-output-quality-pipeline/quickstart.md`
- [ ] T105 [P] Run and fix ESLint validation with `npm run lint` and record the result in `specs/002-output-quality-pipeline/quickstart.md`
- [ ] T106 Run and fix the full Jest suite with `npm test` and record the result in `specs/002-output-quality-pipeline/quickstart.md`
- [ ] T107 [P] Run the evaluation-isolation source scan with `rg -n "src/evaluation|quality-eval" src/screens src/navigation src/history src/store src/inference` and record the result in `specs/002-output-quality-pipeline/quickstart.md`
- [ ] T108 [P] Review the production inference path for zero network additions in `src/inference/InferenceQueue.ts`
- [ ] T109 [P] Review single-flight queue lock coverage after all pipeline changes in `src/inference/InferenceQueue.ts`
- [ ] T110 [P] Review that any dev-only recorder UI still uses `src/constants/theme.ts` and that no unrelated theme drift was introduced in `src/screens/` or `src/components/`
- [ ] T111 Update Feature 002 quickstart with the final manual validation order for smoke runs, full official evaluation, and release gating in `specs/002-output-quality-pipeline/quickstart.md`

---

## Dependencies and Execution Order

### Phase Dependencies

- **Phase 1 Setup and Fixed Evaluation Artifacts**: No dependencies.
- **Phase 2 Production Quality Foundation**: Depends on Phase 1.
- **US2 generation-setting correction**: Depends on Phase 2.
- **US2 grounded prompting**: Depends on generation-setting correction.
- **US1 two-stage first-turn pipeline**: Depends on grounded prompting.
- **US1 objective result DTO and metrics**: Depends on the two-stage first-turn pipeline.
- **US6 dev-only recorder, run storage, and export**: Depends on the production objective result DTO.
- **US5 smoke evaluation**: Depends on the recorder/export path.
- **US3 context correction**: Depends on the two-stage pipeline and should be measured with the smoke subset after recorder/export exists.
- **US4 image preprocessing correction**: Depends on Phase 2 and should be measured with the smoke subset after recorder/export exists.
- **US5 final full evaluation**: Depends on US1-US4 stabilized behavior plus the recorder/export path.
- **Phase 15 Polish**: Depends on all selected stories.

### User Story Dependencies

- **US2 (P1)**: First quality variable after the fixed foundations; corrects generation settings and prompting.
- **US1 (P1 MVP)**: Core two-stage answer behavior and production DTO exposure; recorder work must wait for this.
- **US6 (P2)**: Recorder/storage/export depends on neutral production DTO exposure and must remain removable.
- **US5 (P2)**: Smoke/full evaluation depends on the recorder/export path and the relevant pipeline version being available.
- **US3 (P1)**: Context correction depends on correct hidden evidence persistence from US1.
- **US4 (P2)**: Image preservation is independent after the production foundation but is measured through the recorder/export path.

### Within Each User Story

- Write tests first and verify they fail before implementation for inference, preprocessing, DTO exposure, and evaluation-recorder logic.
- Implement narrow helpers before store/queue integration.
- Keep production screens out of business logic.
- Use the fixed 6-case smoke subset after isolated quality-changing phases; reserve the full 18-case set for the final stabilized candidate and official baseline/candidate comparison.

---

## Parallel Opportunities

- Setup tasks T002-T009 can run in parallel where they touch separate evaluation docs/tests.
- Production foundation tests T020-T024 can run in parallel.
- US2 tests T029-T030 and T033-T035 can run in parallel before implementation.
- US1 tests T039-T046 and T053-T055 can run in parallel before implementation.
- Recorder/export tests T059-T072 can run in parallel by module boundary.
- US3 tests T080-T083 can run in parallel before implementation.
- US4 tests T088-T090 can run in parallel before implementation.
- Polish checks T104, T105, T107, T108, T109, and T110 can run in parallel when code is stable.

## Parallel Example: Recorder Work

```text
Task: "T059 [P] [US6] Add tests that objective fields are populated from the production result DTO in tests/unit/evaluation/EvaluationRecorder.test.ts"
Task: "T060 [P] [US6] Add tests that subjective fields are entered separately from objective fields in tests/unit/evaluation/EvaluationRecorder.test.ts"
Task: "T061 [P] [US6] Add tests that the recorder is unavailable in production builds in tests/contract/evaluation-isolation.test.ts"
Task: "T072 [P] [US6] Add source-scan tests that no production module imports evaluation modules in tests/contract/evaluation-isolation.test.ts"
```

## Parallel Example: Context and Image Tests

```text
Task: "T080 [P] [US3] Add failing tests for live managed follow-up send-only-new-message policy in tests/unit/store/inferenceStore.hydration.test.ts"
Task: "T081 [P] [US3] Add failing tests for deterministic bounded model-message assembly in tests/unit/inference/ContextBuilder.test.ts"
Task: "T088 [P] [US4] Add failing tests that extreme aspect ratio images are preserved without default center crop in tests/unit/inference/ImageEnhancer.test.ts"
Task: "T090 [P] [US4] Add failing tests that the final 512x512 ceiling remains enforced after preservation in tests/unit/inference/ImagePreprocessor.test.ts"
```

---

## Implementation Strategy

### Foundation First

1. Complete fixed evaluation schemas, full case set, and smoke subset definitions.
2. Complete production quality foundation contracts and identifiers.
3. Correct runtime generation settings and prompting before the two-stage pipeline.
4. Complete the two-stage first-turn pipeline and production-owned objective result DTO exposure.
5. Only then build the dev-only evaluation recorder, local run storage, and JSONL export path.

### Reduced-Workload Evaluation

1. Use the fixed 6-case smoke subset for intermediate comparisons after isolated quality-changing phases.
2. Require the evaluator to do only: run case -> score subjective fields -> optional note -> Save Result.
3. Export JSONL from the app instead of manually reconstructing artifacts on a PC.
4. Reserve the full 18-case set for the final stabilized candidate and official baseline/candidate comparison.

### Release Gate

Before claiming release readiness, complete T104-T111 and ensure:
- smoke comparisons exist for the isolated quality-changing phases that were implemented
- final official baseline/candidate exports exist for the stabilized pipeline
- exported records satisfy the evaluation result contract
- the recorder remains unavailable in production builds

## Summary

- **Total tasks**: 111
- **Completed tasks already reflected in repo**: 28
- **Setup and fixed evaluation artifact tasks**: 19
- **Production foundation tasks**: 9
- **US2 tasks**: 10
- **US1 tasks**: 20
- **US6 tasks**: 17
- **US5 tasks**: 12
- **US3 tasks**: 8
- **US4 tasks**: 7
- **Polish tasks**: 8
- **Suggested MVP scope**: Phase 1 + Phase 2 + US2 + US1 + US6 through recorder/export, then the initial 6-case smoke evaluation
