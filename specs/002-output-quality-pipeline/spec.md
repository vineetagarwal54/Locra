# Feature Specification: Output Quality Pipeline

**Feature Branch**: `[002-output-quality-pipeline]`

**Created**: 2026-07-07

**Status**: Draft

**Input**: User description: "Build the next Locra feature: Output Quality Pipeline. Improve answer relevance, grounding, usefulness, consistency, first-turn answer generation, conversation context handling, image preservation for tall/document-like images, and repeatable local quality evaluation while keeping inference fully offline and preserving existing safety guarantees."

## Clarifications

### Session 2026-07-07

- Q: How should the fixed quality evaluation be operated and scored? -> A: Semi-automated local evaluation: answer text and timing are captured automatically; a tester scores correctness, usefulness, hallucination, repetition, and truncation.
- Q: What image source should the fixed evaluation set use? -> A: Hybrid: repo-tracked images for most cases, documented manual images only for device/camera-specific cases.
- Q: What scoring scale should subjective evaluation fields use? -> A: 1-5 rubric for usefulness and quality fields, with pass/fail for direct answer, hallucination, repetition, and truncation.
- Q: What environment is required for official baseline and improved evaluation results? -> A: Physical Android device is required for official baseline and improved evaluation results.
- Q: Where should official evaluation results be stored? -> A: Versioned local result files saved as project artifacts that can be reviewed and compared.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First Image Question Gets a Real Answer (Priority: P1)

A user asks a question about a captured or selected image and receives a direct, useful answer to that question. The app may inspect the image and preserve grounded visual evidence internally, but the visible response must not be only a structured extraction list unless the user explicitly asked for extraction-style output.

**Why this priority**: This is the core product problem. Users currently risk seeing internal visual notes instead of an answer, which makes the app feel unreliable even when the image was understood.

**Independent Test**: Can be tested by asking practical, factual, and troubleshooting questions about images and verifying that the visible answer directly addresses the question while staying grounded in visible evidence.

**Acceptance Scenarios**:

1. **Given** an image of a worn cooking pan and the question "How do I fix this?", **When** the user submits the first turn, **Then** the answer gives practical troubleshooting guidance based on the visible pan condition and does not show a raw "Subject/object; Visible features" style list.
2. **Given** an image containing a clear product label and the question "Is this safe to use for a child?", **When** the user submits the first turn, **Then** the answer separates what is visible on the label from general safety guidance and briefly states any important uncertainty.
3. **Given** an image where key visual evidence is unclear, **When** the user asks for advice, **Then** the answer states the uncertainty briefly and gives cautious next steps instead of inventing details.

---

### User Story 2 - Grounded Useful Advice (Priority: P1)

A user asks a practical question about an image and receives advice that combines visible evidence with appropriate general knowledge. Claims about the image remain tied to what is visible; general advice is allowed when it helps answer the user's question.

**Why this priority**: Locra should be useful, not just descriptive. Many real questions are about what to do next, what something means, or how to compare options.

**Independent Test**: Can be tested with images of damaged objects, appliance/error screens, labels, receipts, and household items where the expected answer needs both observation and general knowledge.

**Acceptance Scenarios**:

1. **Given** an image of an appliance error screen, **When** the user asks "What should I do?", **Then** the answer mentions the visible error information and provides practical steps without claiming unseen diagnostics.
2. **Given** an image of a stained fabric item, **When** the user asks "How can I clean this?", **Then** the answer identifies visible stain/context when possible and gives safe cleaning steps with caveats when fabric type is unclear.

---

### User Story 3 - Follow-Ups Use the Right Amount of Context (Priority: P1)

A user continues an active conversation and Locra uses the existing live conversation context without repeatedly embedding the full prior transcript into each new prompt. When a user resumes a persisted conversation after the live context is unavailable, Locra reconstructs enough visual and recent conversational context once, then continues normally.

**Why this priority**: Duplicated context can reduce answer quality, waste limited context capacity, and make follow-ups drift or repeat. Resumed chats still need enough memory to stay useful.

**Independent Test**: Can be tested by comparing active follow-ups, resumed follow-ups, and later post-resume follow-ups for context retention, lack of duplicated transcript artifacts, and correct image grounding.

**Acceptance Scenarios**:

1. **Given** an active live image conversation with a completed first turn, **When** the user asks a follow-up such as "What about the handle?", **Then** Locra sends only the new user question as the visible turn content and relies on existing live context for prior turns.
2. **Given** a persisted conversation reopened from history, **When** the user asks the first follow-up after resume, **Then** Locra has enough visual evidence and recent conversation context to answer coherently.
3. **Given** a resumed conversation has already been reconstructed once, **When** the user asks another follow-up, **Then** the app does not repeatedly embed the entire prior transcript into every new user message.

---

### User Story 4 - Tall and Document-Like Images Preserve Meaningful Content (Priority: P2)

A user submits a tall screenshot, receipt, document, error screen, code screenshot, or chat screenshot and the app preserves the important visible content by default instead of destructively center-cropping it.

**Why this priority**: Many high-value questions involve screens and documents. Removing the top, bottom, or sides of these images can make the model answer the wrong question even when the original image contained the needed evidence.

**Independent Test**: Can be tested with tall screenshots and document-like images where important text appears near the edges or across multiple vertical regions.

**Acceptance Scenarios**:

1. **Given** a tall receipt with key totals near the bottom, **When** the user asks "What is the total?", **Then** the preprocessing behavior preserves the area containing the total unless there is a clear subject-specific reason to crop elsewhere.
2. **Given** a phone screenshot with an error message at the top and controls at the bottom, **When** the user asks what to do, **Then** the answer can use both regions when they are visible in the source image.

---

### User Story 5 - Repeatable Quality Evaluation (Priority: P2)

A developer or tester can manually run a fixed evaluation case through the real Locra app, score only the subjective fields in a lightweight dev-only recorder, and export comparable baseline/candidate JSONL artifacts without manually retyping objective inference data.

**Why this priority**: Output quality must improve through repeatable evidence, not subjective one-off examples. The feature needs a baseline and a way to detect regressions.

**Independent Test**: Can be tested by manually running the fixed 6-case smoke subset through the real app, confirming objective fields are auto-populated from the production result DTO, saving multiple scored cases into one run, exporting JSONL, and comparing baseline versus candidate artifacts.

**Acceptance Scenarios**:

1. **Given** a fixed evaluation case has just completed in the real app, **When** the developer opens the dev-only evaluation recorder, **Then** all available objective fields from the production-owned result record are already populated and the developer only needs to enter direct answer, core correctness, hallucination, usefulness, and optional notes.
2. **Given** multiple manually run cases belong to the same evaluation session, **When** the developer taps Save Result after each case, **Then** the results accumulate in one local evaluation run without entering normal conversation history.
3. **Given** a saved evaluation run exists, **When** the developer taps Export Results, **Then** the app produces a JSONL artifact that can be used for baseline-versus-candidate comparison without manually copying answer text, metrics, or identifiers on a PC.

---

### User Story 6 - Isolated Evaluation Recording (Priority: P2)

A developer or tester can use a removable dev-only evaluation recorder that consumes the real production result DTO, saves evaluation-only run data locally, exports JSONL artifacts, and remains unavailable in release builds.

**Why this priority**: Quality experiments need to be easy to compare, but evaluation tooling must remain removable and must not create production behavior, telemetry, account, or storage obligations.

**Independent Test**: Can be tested by confirming the recorder is available only in development builds, removing evaluation-only modules/artifacts without breaking production compilation, and verifying that Save Result and Export Results do not affect normal history, flagging, or production navigation.

**Acceptance Scenarios**:

1. **Given** a development build with evaluation tooling enabled, **When** a case completes and the recorder is opened, **Then** the recorder consumes the production-owned objective result DTO without requiring any production inference import from `src/evaluation`.
2. **Given** Save Result is used, **When** the record is persisted, **Then** the evaluation data is stored in evaluation-only storage and does not appear in normal conversation history, flagging data, or production analytics.
3. **Given** a release/production build, **When** the app runs normally, **Then** the evaluation recorder is unavailable and production camera, chat, history, and navigation flows do not depend on it.

---

### Edge Cases

- First-turn questions that explicitly ask for a list of visible details should be allowed to return list-like answers.
- Images with unreadable or partially cropped text should produce brief uncertainty rather than fabricated text.
- General knowledge follow-ups should be answered when they are useful, while image-specific claims must remain grounded in visible or remembered visual evidence.
- Resumed conversations with missing or corrupted history should degrade gracefully and explain that context is unavailable.
- Cancellation during visual inspection or answer generation must not save partial misleading answers.
- Evaluation cases should remain fixed unless deliberately versioned, so scores are comparable over time.
- Very long or dense screenshots may still require concise answers and uncertainty if not all content is legible.
- Evaluation-only result recording must never write to normal user conversation history.
- Evaluation helpers must tolerate missing manual scores so objective output can be captured first and scored later.
- The dev-only evaluation recorder must be unavailable in release builds.
- Exported evaluation artifacts must still be valid when prompt token counts are unavailable from the runtime.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: For every first-turn image question, the system MUST separate visual evidence gathering from the user-facing answer.
- **FR-002**: The system MUST preserve concise grounded visual evidence as hidden conversation memory for the current image conversation.
- **FR-003**: The first visible answer MUST answer the user's original question directly, unless the user explicitly requested raw extraction, classification, or a visible-detail list.
- **FR-004**: The first visible answer MUST distinguish visible facts from general knowledge when both are used.
- **FR-005**: The system MUST avoid unsupported claims about image content that is not visible or not preserved in hidden visual memory.
- **FR-006**: When important visual evidence is unclear, the answer MUST briefly state the uncertainty and still provide the safest useful answer it can.
- **FR-007**: Practical "what should I do" questions MUST receive actionable steps when sufficient context is available.
- **FR-008**: The persistent assistant instructions MUST prioritize direct answers, visual grounding, concise default style, useful steps, and reliability over personality or roleplay behavior.
- **FR-009**: Generation behavior MUST be evaluated against the model's recommended default sampling behavior before adopting more creative custom sampling behavior.
- **FR-010**: Active live follow-up messages MUST avoid replaying the full prior transcript when the live conversation already contains valid context.
- **FR-011**: Resumed conversations MUST reconstruct the required visual evidence and recent conversation context when live context is unavailable.
- **FR-012**: After a resumed conversation has reconstructed context once, later messages in that session MUST continue without repeatedly embedding the full prior transcript.
- **FR-013**: New image conversations MUST start with clean conversation context and MUST NOT inherit hidden visual memory from prior images.
- **FR-014**: The image preparation behavior MUST preserve meaningful content in tall, wide, screenshot-like, receipt-like, document-like, code-like, and chat-like images by default.
- **FR-015**: The system MUST NOT crop tall or wide images solely because they exceed a preferred aspect ratio unless a clear subject-region reason is available.
- **FR-016**: The system MUST keep the existing memory-safety ceiling for model input images.
- **FR-017**: The system MUST preserve existing cancellation, error, persistence, history, flagging, voice dictation, and single-flight inference behavior.
- **FR-018**: The system MUST NOT introduce cloud inference, cloud evaluation, cloud OCR, alternate user-facing model selection, document retrieval, storage-management changes, or model training/distillation.
- **FR-019**: The system MUST provide a fixed local quality evaluation set covering basic visible facts, OCR/text reading, visual reasoning, practical grounded advice, active follow-up context, and resumed conversation context.
- **FR-019a**: The fixed evaluation set MUST use repo-tracked sample images for most cases, with documented manual image instructions only for cases that specifically require physical camera or device-specific capture behavior.
- **FR-020**: When a manually run evaluation case completes, the production inference pipeline MUST expose a complete production-owned objective inference result record containing all available objective fields needed for evaluation capture.
- **FR-020a**: The production-owned objective inference result record MUST include answer text, model identifier, generation configuration identifier, pipeline variant identifier, perception latency, answer time-to-first-token, answer-generation latency, total end-to-end latency, generated token count, prompt token count when available, looping status, truncation status, timestamp, and device/build metadata.
- **FR-021**: A lightweight dev-only evaluation recorder MUST consume the current production-owned objective inference result record without requiring production inference to import or depend on evaluation code.
- **FR-022**: The dev-only evaluation recorder MUST allow the developer/tester to select or confirm the evaluation `caseId`, set `directAnswer`, `coreCorrectness`, `hallucination`, `usefulness`, optionally enter notes, and save the complete result without manually copying objective fields.
- **FR-023**: Save Result MUST persist the complete evaluation record in evaluation-only local storage that is separate from normal conversation history, production MMKV history records, flagging data, and normal user analytics.
- **FR-024**: The evaluation recorder MUST support accumulating multiple saved case results into one evaluation run and exporting that run as a JSONL artifact.
- **FR-025**: Export Results MUST produce JSONL records that conform to the evaluation result contract and can be used for baseline-versus-candidate comparison without manually typing answer text, latency values, token counts, identifiers, timestamps, or device/build metadata on a PC.
- **FR-026**: The system MUST provide a fixed 6-case smoke subset for intermediate comparisons and use the full 18-case set only for final stabilized candidate validation.
- **FR-027**: Official baseline and candidate evaluation recording tasks MUST happen only after the relevant pipeline version is available and the dev-only recorder plus export path exist.
- **FR-028**: Official baseline and improved evaluation results MUST be recorded from physical Android device runs; non-device dry-runs may support development but MUST NOT be treated as official quality evidence.
- **FR-029**: Official evaluation results MUST be saved as versioned local project artifacts containing per-case objective fields, tester-entered subjective fields, and required run metadata so baseline and improved runs can be reviewed and compared.
- **FR-030**: Evaluation tooling MUST be isolated from production behavior in a clearly separated `quality-eval/` project area containing fixed cases, subset definitions, rubric documentation, exported results, and evaluation instructions; any runtime helper module needed to consume production inference outputs MUST live under an evaluation-only module area such as `src/evaluation/`.
- **FR-030a**: Production inference MUST expose a production-owned objective inference result record after each completed inference, without importing from `src/evaluation/` or `quality-eval/`. Evaluation code may consume this neutral DTO, but production inference must not depend on evaluation modules to produce it.
- **FR-031**: Production screens, production navigation, normal user history, and production inference behavior MUST NOT depend on evaluation-only modules or evaluation artifacts, and evaluation records MUST NOT enter normal user history.
- **FR-032**: Evaluation runs MUST use the same production inference path and quality pipeline as normal Locra image questions, including the same model, image preparation, prompts, generation settings, and metrics capture.
- **FR-033**: The evaluation recorder MUST be unavailable in production/release builds and easy to remove later; removing the evaluation project area and any evaluation-only helper module MUST NOT break the production Locra app.
- **FR-034**: Evaluation tooling MUST NOT introduce automated batch case execution, a large evaluation dashboard, cloud services, analytics backends, cloud upload, consumer-facing rating UI, automatic subjective scoring, a mock inference path, alternate model path, or a separate evaluation app.
- **FR-035**: Feature planning and task generation MUST include explicit tasks for defining the case schema, defining the result schema, creating the fixed evaluation set and smoke subset, documenting the scoring rubric, exposing the production DTO, building the dev-only recorder, local evaluation run storage, JSONL export, smoke comparisons, final official full-set evaluation, and verifying evaluation isolation/removability.
- **FR-036**: Exported official baseline and candidate result artifacts MUST include official-run metadata: `official: true`, case-set version, pipeline variant, model identifier, generation configuration identifier, device name/model, app/build identifier, and execution date.
- **FR-037**: Tester-entered usefulness and qualitative answer-quality fields MUST use a defined 1-5 rubric, while direct answer, core correctness, and hallucination remain manual evaluator inputs that are captured separately from objective fields.

### Key Entities *(include if feature involves data)*

- **Hidden Visual Evidence**: Concise grounded observations extracted from the image for internal conversation memory; includes visible objects, relevant attributes, readable text when legible, and uncertainty notes.
- **User-Facing Answer**: The answer shown to the user; directly addresses the user's question and may combine hidden visual evidence with general knowledge.
- **Conversation Context State**: Whether a conversation is live with valid managed context, newly resumed and requiring reconstruction, or post-reconstruction and ready for normal follow-ups.
- **Evaluation Case**: A fixed test item containing a stable case identifier, image source, question, category, expected quality criteria, and scoring fields.
- **Evaluation Image Source**: The stable image input for an evaluation case; normally a repo-tracked sample image, with documented manual capture instructions only for device-specific cases.
- **Evaluation Run**: A recorded pass over the fixed evaluation set, including automatically captured answers and timing plus tester-entered quality scores for each case.
- **Official Evaluation Run**: A physical Android device run over the fixed evaluation set that is eligible for baseline and improved-result comparison.
- **Evaluation Result Artifact**: A versioned local project artifact containing small JSON or JSONL-style records with recorded outputs, objective timing/token/status fields, tester scoring, and aggregate summary for an official evaluation run.
- **Objective Inference Result Record**: A production-owned result object emitted or exposed after a completed inference; evaluation tooling may consume/export it, but production inference must not depend on evaluation-only modules or artifacts.
- **Pipeline Variant**: A named output-quality pipeline version or candidate being evaluated against the same fixed cases and rubric.
- **Manual Score**: Tester-entered quality assessment containing direct-answer pass/fail, core-correctness pass/fail, hallucination yes/no, usefulness 1-5, and optional notes.
- **Quality Result**: Per-case assessment of answer directness, correctness, hallucination, usefulness, repetition, truncation, and timing.
- **Scoring Rubric**: A stable 1-5 scale for subjective usefulness and answer-quality scoring, paired with pass/fail checks for direct answer, unsupported visual details, repetition/looping, and truncation.
- **Evaluation Project Area**: The isolated local project structure for evaluation cases, images, results, rubric, and instructions; it is not part of production navigation, normal history, or consumer-facing UI.

### Planning Coverage Requirements

The generated implementation plan and task list MUST include focused tasks for:

- Defining the evaluation case schema.
- Defining the evaluation result schema.
- Creating the fixed evaluation set and image-source inventory.
- Defining the fixed 6-case smoke subset.
- Documenting the scoring rubric.
- Exposing the production-owned objective inference result record before evaluation recording begins.
- Building the dev-only evaluation recorder UI and evaluation-only run storage.
- Exporting saved evaluation runs as contract-valid JSONL.
- Recording smoke-subset baseline/candidate runs only after the recorder/export path exists.
- Repeating smoke-subset comparisons after isolated quality-changing phases where useful.
- Recording final full-set official baseline/candidate results only after the stabilized pipeline and recorder/export path exist.
- Comparing baseline versus candidate results.
- Verifying that evaluation tooling is isolated, removable, and not imported by production screens, navigation, normal history, or production-only app flow.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the fixed evaluation set, at least 90% of first-turn image questions receive a direct answer to the user's question rather than only an internal-style visual extraction.
- **SC-002**: In the fixed evaluation set, unsupported image-specific claims occur in no more than 10% of evaluated answers.
- **SC-003**: Practical advice cases improve average usefulness score by at least 30% compared with the recorded baseline.
- **SC-003a**: Every subjective usefulness or answer-quality score in an evaluation run uses the same documented 1-5 rubric for baseline and improved runs.
- **SC-004**: Active follow-up cases show no repeated full-transcript embedding artifacts in 100% of evaluated conversations.
- **SC-005**: Resumed conversation cases retain enough visual and recent conversational context to answer correctly in at least 80% of evaluated cases.
- **SC-006**: Tall or document-like image cases preserve the user-relevant content needed to answer in at least 85% of evaluated cases.
- **SC-007**: Repetition or looping appears in no more than 5% of evaluated answers.
- **SC-008**: Truncation that prevents the user from receiving a usable answer appears in no more than 5% of evaluated answers.
- **SC-009**: The fixed evaluation set includes at least 18 cases, with at least 3 cases each for visible facts, OCR/text reading, visual reasoning, practical advice, active follow-up context, and resumed conversation context.
- **SC-009a**: At least 80% of evaluation cases use repo-tracked sample images so baseline and improved runs are directly comparable.
- **SC-010**: For 100% of saved evaluation results, all available objective fields are auto-populated from the production-owned result DTO and the evaluator only enters direct answer, core correctness, hallucination, usefulness, and optional notes.
- **SC-011**: All feature behavior remains available without network access after required local assets are present.
- **SC-012**: Intermediate evaluation checkpoints use the fixed 6-case smoke subset, and final release-quality validation uses the full 18-case set.
- **SC-013**: Each exported evaluation run produces a reviewable local JSONL artifact with one valid record per saved case for 100% of completed cases.
- **SC-014**: Removing evaluation-only folders/modules and disabling the recorder in release builds does not break the production app flow or require changes to production screens, production navigation, or normal user history.
- **SC-015**: Every official evaluation result record includes the required objective fields for 100% of completed cases and supports manual score fields without requiring them at capture time.
- **SC-016**: Baseline and candidate result artifacts can be compared by case identifier and pipeline variant for 100% of shared cases.
- **SC-017**: Every official baseline and candidate artifact includes official-run metadata for 100% of result records or the containing run manifest.

## Assumptions

- The primary user is an Android user asking questions about a single image or continuing a conversation about that image.
- The feature uses the existing local on-device vision model and does not add any new user-facing model choice.
- Quality evaluation is local and repeatable; answer text and timing are captured automatically, while human review is used for rubric fields such as correctness, usefulness, unsupported visual detail, repetition, and truncation.
- The fixed evaluation set uses repo-tracked sample images wherever possible; documented manual images are reserved for physical-device or camera-specific cases that cannot be represented reliably by static assets.
- Local non-device evaluation dry-runs may be used during development, but only physical Android device runs count toward official baseline and improved quality comparisons.
- Official evaluation result artifacts are local project files; they are not uploaded to a service and must not require cloud storage.
- Evaluation assets and result artifacts live outside the production user flow and are intended for developers/testers, not end users.
- Production inference code may expose already-available objective results and metrics for evaluation consumption, but production code does not import from evaluation-only folders or modules.
- Official baseline artifacts are captured from a recorder-enabled baseline variant of the relevant pipeline, not from the removed manual PC-side transcription workflow.
- The evaluation workflow remains manual case execution, but subjective recording is reduced to confirming `caseId`, scoring three yes/no fields plus usefulness 1-5, optionally adding notes, and tapping Save Result.
- Exported JSONL artifacts come from a dev-only in-app export action rather than manually copying answer text and metrics into PC-side files.
- A dedicated evaluation dashboard, batch automation, or production rating UI is out of scope.
- The existing conversation history remains local and continues to be the source for resumed conversations.
- The existing model download and availability flow remains unchanged.
- The existing hard image-size safety ceiling remains mandatory even if image preservation behavior changes before that ceiling.
- Storage lifecycle cleanup, document retrieval, separate OCR models, and alternate model fallback remain out of scope for this feature.
