# Data Model: Output Quality Pipeline

## HiddenVisualEvidence

Concise grounded observations extracted from one source image and stored as hidden memory for that image conversation.

**Fields**:
- `version`: evidence prompt/schema version.
- `imagePath`: local path associated with the conversation image.
- `sourceQuestion`: user question that guided the perception pass.
- `subjectObject`: short visible subject/object description.
- `visibleFeatures`: visible colors, shapes, materials, layout, damage, state, or other concrete features.
- `visibleText`: exact readable visible text when legible.
- `visibleCondition`: visible condition/state relevant to the question.
- `uncertainty`: brief notes for unclear, partial, or unreadable visual evidence.
- `createdAt`: local timestamp.

**Validation**:
- Must contain only visible or explicitly uncertain evidence.
- Must not include advice, diagnosis, hidden causes, or unsupported claims.
- Must be replaced when a new image conversation starts.

## UserFacingAnswerRequest

Inputs for the answer step shown to the user.

**Fields**:
- `question`: original user-visible question.
- `hiddenEvidence`: `HiddenVisualEvidence` for image turns, when available.
- `conversationMode`: `live`, `resumeReconstruction`, or `postReconstruction`.
- `generationConfigId`: named sampling configuration.
- `pipelineVariantId`: named output-quality pipeline version.

**Validation**:
- First image turns must include the original question and hidden evidence.
- Active live follow-ups must not embed the whole prior transcript into a prompt string or rely on managed runtime history.
- Resume reconstruction may include recent persisted turns once.

## ConversationContextState

Tracks whether the current engine/session can rely on managed history.

**States**:
- `newImageConversation`: no prior hidden evidence or managed history should be reused.
- `liveCanonical`: Locra has canonical persisted/in-memory turns for the active chat.
- `resumeNeedsReconstruction`: persisted session reopened without live engine history.
- `resumeReconstructed`: required visual evidence and recent turns were injected once.
- `unavailable`: persisted context is missing/corrupt and must degrade gracefully.

**Transitions**:
- New image submitted -> `newImageConversation`.
- First answer completed -> `liveManaged`.
- History session reopened -> `resumeNeedsReconstruction`.
- Resumed follow-up -> bounded context rebuilt from canonical persisted turns.
- Later resumed follow-ups -> `liveManaged`-style send-only-new-message behavior.
- Reset/new capture -> `newImageConversation`.

## PipelineVariant

Named output-quality pipeline configuration used for comparison.

**Fields**:
- `id`: stable identifier such as `baseline-current`, `two-stage-v1`, or `recommended-sampling-v1`.
- `promptVersion`: system/answer prompt version.
- `perceptionPromptVersion`: hidden evidence prompt version.
- `preprocessingVersion`: image preparation behavior version.
- `generationConfigId`: named generation configuration.
- `notes`: short local notes.

## EvaluationCase

Fixed quality test item.

**Fields**:
- `caseId`: stable unique identifier.
- `category`: `visibleFacts`, `textReading`, `visualReasoning`, `practicalAdvice`, `activeFollowUpContext`, or `resumedConversationContext`.
- `title`: short human-readable case name.
- `imageSource`: `EvaluationImageSource`.
- `question`: first user prompt.
- `followUps`: ordered follow-up prompts for context cases.
- `expectedCriteria`: concise criteria the evaluator uses to judge correctness/usefulness.
- `tags`: optional stable tags.
- `officialDeviceRequired`: `true` for cases that only count from physical Android device runs.

**Validation**:
- The fixed set must contain at least 18 cases and at least 3 per category.
- At least 80% of cases must use repo-tracked sample images.
- Case changes must be versioned so baseline and candidate runs remain comparable.

## EvaluationImageSource

Stable image source for a case.

**Fields**:
- `type`: `repoAsset` or `manualDeviceCapture`.
- `path`: project-relative image path for `repoAsset`.
- `instructions`: manual capture/setup instructions for `manualDeviceCapture`.
- `licenseOrOrigin`: brief provenance note for tracked images.

## EvaluationResult

One per-case output-quality record.

**Fields**:
- `caseId`: links to `EvaluationCase.caseId`.
- `variant`: `PipelineVariant.id`.
- `modelId`: model identifier used by production inference.
- `generationConfigId`: named generation settings used.
- `output`: raw visible answer text.
- `perceptionLatencyMs`: hidden perception/extraction duration.
- `answerTtftMs`: final answer time to first token.
- `answerGenerationLatencyMs`: final answer generation duration.
- `totalEndToEndLatencyMs`: total response time from accepted request through completed result.
- `generatedTokens`: generated token count.
- `promptTokens`: prompt token count when available.
- `looping`: objective or evaluator-marked looping status.
- `truncated`: objective or evaluator-marked truncation status.
- `timestamp`: ISO timestamp.
- `deviceNameModel`: physical device name/model for official runs.
- `appBuildId`: app/build identifier for exported runs.
- `manualScore`: optional `ManualScore`.

**Validation**:
- Objective fields must be auto-populated from the production inference result DTO when available.
- Manual score may be absent at capture time.
- Evaluation results must not be saved into normal user history.

## ObjectiveInferenceResultRecord

Production-owned objective record exposed after each completed inference. Evaluation tooling may consume/export this record, but production inference must not import evaluation modules or artifacts.

**Fields**:
- `answerText`: final user-visible answer text.
- `perceptionLatencyMs`: hidden perception/extraction duration.
- `answerTtftMs`: final answer time to first token.
- `answerGenerationLatencyMs`: final answer generation duration.
- `totalEndToEndLatencyMs`: full request duration from accepted submit through completed persistence-ready result.
- `generatedTokens`: generated token count.
- `promptTokens`: prompt token count when available.
- `truncated`: whether truncation affected the answer.
- `looping`: whether looping/repetition trimming affected the answer.
- `timestamp`: ISO timestamp.
- `modelId`: production model identifier.
- `generationConfigId`: stable generation configuration identifier.
- `pipelineVariantId`: stable pipeline variant identifier.
- `deviceNameModel`: physical device name/model for the completed run.
- `appBuildId`: app/build identifier for the completed run.

**Validation**:
- Must be owned by production inference/types, not `src/evaluation/`.
- Must not be stored in normal conversation history unless already represented by existing production metrics fields.
- Must be exportable through the dev-only evaluation recorder into `quality-eval/results/` JSONL artifacts.

## EvaluationRunStorage

Evaluation-only local storage for in-progress and saved dev-only runs.

**Fields**:
- `runId`: stable local identifier for the current evaluation run.
- `variant`: evaluated pipeline variant.
- `caseSetVersion`: fixed case set version.
- `savedResults`: ordered `EvaluationResult` entries.
- `exportedAt`: timestamp of last JSONL export, when present.

**Validation**:
- Must be separate from production MMKV history, flagging data, and analytics.
- Must support accumulating multiple cases into one run.
- Must be removable without production compile/runtime impact.

## DevOnlyEvaluationRecorderState

Development-only recorder state for the current completed result.

**Fields**:
- `currentObjectiveRecord`: latest `ObjectiveInferenceResultRecord` available for scoring.
- `selectedCaseId`: chosen or confirmed evaluation case id.
- `subjectiveDraft`: pending `ManualScore` values.
- `isAvailable`: whether the recorder is enabled in the current build.

**Validation**:
- Must be unavailable in release builds.
- Must keep subjective input separate from objective fields.

## OfficialRunMetadata

Metadata required for official baseline and candidate artifacts.

**Fields**:
- `official`: must be `true`.
- `caseSetVersion`: fixed case set version.
- `pipelineVariantId`: evaluated pipeline variant.
- `modelId`: model identifier.
- `generationConfigId`: generation configuration identifier.
- `deviceNameModel`: physical device name/model.
- `appBuildId`: app/build identifier.
- `executionDate`: ISO date or timestamp.

**Validation**:
- Required for every official baseline/candidate artifact, either per record or in a containing run manifest.

## ManualScore

Tester-entered subjective assessment.

**Fields**:
- `directAnswer`: pass/fail boolean.
- `coreCorrectness`: pass/fail boolean.
- `hallucination`: yes/no boolean.
- `usefulness`: integer 1-5.
- `notes`: optional text.

**Validation**:
- `usefulness` must use the same rubric for baseline and candidate runs.
- `hallucination: true` means unsupported image-specific details appeared.

## EvaluationRun

Versioned pass over the fixed case set.

**Fields**:
- `runId`: stable run identifier.
- `runType`: `baseline`, `candidate`, or `dryRun`.
- `official`: boolean; `true` only for physical Android device runs.
- `device`: physical device summary for official runs.
- `pipelineVariantId`: variant under test.
- `caseSetVersion`: fixed case set version.
- `startedAt` / `completedAt`: timestamps.
- `results`: ordered `EvaluationResult` records or path to JSONL file.
- `summary`: aggregate counts/scores.

**Validation**:
- Official baseline/candidate comparisons require `official: true`.
- Baseline and candidate comparison must match records by `caseId` and `variant`.
