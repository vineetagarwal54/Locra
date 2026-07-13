# Research: Output Quality Pipeline

## Decision: Use a two-step first-turn image pipeline

**Decision**: First image turns run a hidden perception step to produce concise grounded visual evidence, then run a separate user-facing answer step using the original user question plus that hidden evidence.

**Rationale**: The current first-turn path builds a structured extraction prompt and can surface extraction-shaped output as the visible answer. Separating perception from answer generation directly satisfies FR-001 through FR-007 while keeping the evidence available for later turns.

**Alternatives considered**:
- Surface the extraction as the answer: rejected because it fails the core product goal.
- Prompt only the existing extraction step to be friendlier: rejected because hidden memory and visible answer remain coupled.
- Skip structured evidence entirely: rejected because resumed context and grounding need concise persistent visual memory.

## Decision: Optimize prompts for a small local model

**Decision**: Replace broad personality-heavy persistent instructions with direct, reliable instructions: answer the actual question, ground image claims in visible evidence, use general knowledge for advice/explanation, be concise by default, and state uncertainty briefly.

**Rationale**: Small on-device VLMs are more sensitive to long, conflicting instructions. The current prompt encourages bold specificity and expansive style, which conflicts with grounded visual claims and uncertainty handling.

**Alternatives considered**:
- Keep the current assistant persona and add more grounding text: rejected because competing instructions increase drift.
- Use highly verbose safety instructions on every turn: rejected because context is limited and follow-ups should not be over-constrained.

## Decision: Evaluate recommended generation defaults before creative sampling

**Decision**: Define named generation configurations, including a model-recommended/default variant, and record the generation configuration identifier in evaluation artifacts before adopting warmer creative settings.

**Rationale**: Installed `react-native-executorch` 0.9.2 exposes `temperature`, `topP`, `minP`, and `repetitionPenalty`. The LFM2.5-VL model constant includes recommended values around `temperature: 0.1`, `minP: 0.15`, `repetitionPenalty: 1.05`. Current Locra settings are warmer (`temperature: 0.7`, `topP: 0.95`, `minP: 0.05`) and should be compared against the recommended behavior.

**Alternatives considered**:
- Immediately tune creative sampling by feel: rejected because the feature requires repeatable evidence.
- Add unsupported settings such as `topK` or native `maxTokens`: rejected because they are not present in the verified 0.9.2 `GenerationConfig`.

## Decision: Locra-owned canonical conversation with stateless ExecuTorch generation

**Decision**: Locra owns the canonical user/assistant turn list and builds an explicit bounded `Message[]` for every model request. ExecuTorch is used through `generate(messages)`, which the installed 0.9.2 API documents as not managing conversation context.

**Rationale**: Maintaining both ExecuTorch `messageHistory` and Locra's persisted conversation creates two semantic histories and can cause transcript replay, prompt echoing, and degraded short follow-ups. A stateless request keeps one source of truth while preserving the single long-lived `useLLM` instance.

**Alternatives considered**:
- Continue using `buildPinnedContextPrompt` for every follow-up: rejected because it serializes transcript text inside a new prompt string.
- Continue using managed `sendMessage`: rejected because ExecuTorch would keep a second hidden conversation history competing with Locra persistence.

## Decision: Rebuild resumed context from canonical turns

**Decision**: When a persisted conversation is reopened, load the canonical turns and use the same bounded message-list builder used for live follow-ups. Hidden prompts, extraction outputs, and inference traces are not replayed.

**Rationale**: Resumed sessions need continuity, but that continuity must come from the same canonical conversation state used by UI and history, not from hidden evidence or stale runtime state.

**Alternatives considered**:
- Require users to reattach the image after resume: rejected because existing history is expected to resume conversations.
- Embed full history into every resumed follow-up forever: rejected because it repeats the current quality problem.

## Decision: Preserve document-like image content by default

**Decision**: Keep orientation normalization and downscaling, but do not center-crop tall/wide images solely because of aspect ratio. Crop only when an explicit subject region exists or a future subject detector provides a reliable region.

**Rationale**: Current `ImageEnhancer.resolveCropRegion` center-crops extreme aspect ratios. That can remove receipt totals, screen headers, controls, code lines, and chat context. The final 512x512 ceiling still protects memory.

**Alternatives considered**:
- Keep center-crop for all extreme aspect ratios: rejected because it destroys content needed for SC-006.
- Remove all preprocessing: rejected because orientation normalization and 512 ceiling are still required.

## Decision: Keep quality evaluation isolated and removable

**Decision**: Store cases, images, rubric, and result artifacts under `quality-eval/`. Put optional helper code under `src/evaluation/`. Production modules may expose already-available outputs/metrics, but production screens/navigation/history/inference must not import evaluation-only code.

**Rationale**: This satisfies FR-025 through FR-033 and avoids turning local quality experiments into production telemetry, history, UI, or analytics.

**Alternatives considered**:
- Add a production rating UI: rejected as explicitly out of scope.
- Build a separate evaluation app or mock pipeline: rejected because evaluation must use the real Locra inference path.
- Store scores in MMKV user history: rejected because evaluation artifacts must not pollute normal user data.

## Decision: Use JSONL-friendly artifacts

**Decision**: Record one reviewable object per case with objective fields captured from the real inference flow and optional manual scoring fields that can be filled later.

**Rationale**: JSON/JSONL is easy to diff, compare by `caseId` and `variant`, export, or delete. It avoids a dashboard while supporting repeatable baseline/candidate comparison.

**Alternatives considered**:
- CSV only: rejected because nested manual score and metadata fields are awkward.
- Database or cloud storage: rejected by the offline/removable evaluation constraint.

## Decision: No new native dependency is needed for Phase 3 contracts

**Decision**: Phase 3 foundational production contracts use TypeScript-only modules and Jest contract/unit tests. No new native dependency is required.

**Rationale**: T020-T028 define shared production types, stable identifiers, and contract coverage only. Existing dependencies already provide the inference, image, storage, and evaluation helper surfaces needed for this phase.

**Alternatives considered**:
- Add a schema-validation library: rejected because the existing evaluation helpers already validate local artifacts with small strict TypeScript functions.
- Add a native metrics or export helper: rejected because this phase only defines the production-owned objective record shape; later integration can expose already-available inference metrics without native code.

## Verified ExecuTorch API facts

- `useLLM({ model })` returns managed `sendMessage`, `messageHistory`, `configure`, `deleteMessage`, `interrupt`, token counters, readiness, streaming response, and error state.
- Vision `sendMessage` accepts media `{ imagePath }` when the model has the vision capability.
- `configure({ chatConfig, generationConfig })` supports generation fields `temperature`, `topP`, deprecated `topp`, `minP`, and `repetitionPenalty`.
- There is no verified native `topK`, `maxTokens`, or sequence-length setting in the installed 0.9.2 types. Locra's output budget remains app-enforced through the queue.
