# Feature Specification: Hybrid Context, Per-Conversation Response Modes & Voice Input

**Feature Branch**: `006-hybrid-context-response-voice`  
**Created**: 2026-07-13  
**Status**: Revised Draft

## Goal

Build Locra's next context architecture around a local SQL conversation store, deterministic hybrid retrieval, reusable image evidence, automatic summaries and durable facts, per-conversation Low/Medium/High response modes, explicit retrieval from a user-selected past chat, and fully offline voice input while preserving the existing Qwen/llama.rn answer and vision pipelines.

## User Scenarios & Testing

### User Story 1 — Scalable SQL conversation history (Priority: P1)

A user can maintain at least 200 conversations, including long conversations with hundreds of messages, without Locra loading all chats or all messages into memory.

**Acceptance Scenarios**

1. Conversation lists and message histories load through stable keyset pagination and bounded pages.
2. The first conversation page contains at most 50 conversations and the first message page contains at most 50 visible messages.
3. The UI keeps a bounded page cache and evicts non-visible pages without changing message order or scroll position.
4. Deleting a conversation removes all associated messages, attempts, chunks, images, evidence, summaries, facts and embeddings.
5. SQL is the only canonical conversation store after this feature begins.
6. Because the app is still in development, existing MMKV chat history may be discarded and no production MMKV-to-SQL migration or rollback system is required in this feature.

---

### User Story 2 — Immutable completed messages and safe retries (Priority: P1)

A user's submitted prompt and every completed, failed or interrupted assistant attempt remain auditable and are never silently rewritten.

**Acceptance Scenarios**

1. A submitted user message becomes immutable immediately.
2. An assistant attempt may append streaming text only while its status is `generating`.
3. When an assistant attempt reaches `completed`, `failed` or `interrupted`, its text and terminal status become immutable.
4. Retrying creates a new assistant attempt linked to the same user message instead of overwriting the earlier attempt.
5. Only the active successful assistant attempt is included in normal model context; failed, interrupted and superseded attempts remain stored for diagnostics but are excluded.
6. Changing which retry attempt is active changes only selection metadata and never mutates the content of an older attempt.
7. Editing or branching a submitted user message is outside this feature; a future edit feature must create a new message or branch instead of rewriting the original.

---

### User Story 3 — Deterministic hybrid context for long chats (Priority: P1)

A user can continue a long conversation and receive an answer that uses the current request, recent exact turns, relevant older content, durable facts and a bounded older-range summary without injecting unrelated information.

**Acceptance Scenarios**

1. Context is assembled in this fixed order: current request, recent exact visible turns, explicitly referenced image evidence, relevant same-chat retrieved items, explicitly selected past-chat items, durable facts and an eligible older-range summary.
2. Exact recent turns are never replaced by vector retrieval.
3. Metadata scope is applied before similarity scoring.
4. Retrieval uses a fixed threshold, mode-specific result limit, source-message deduplication and deterministic tie-breaking.
5. If embeddings are unavailable, stale or still being built, Locra falls back to the existing deterministic lexical retrieval and exact context instead of failing.
6. Identical stored state, request, selected conversation target, response mode and embedding version produce identical context selection and ordering.
7. When the budget is exceeded, lower-priority items are removed first while the current request, explicit image references and configured recent-turn floor remain.

---

### User Story 4 — Automatic summaries and durable facts (Priority: P2)

Long conversations are compacted automatically by fixed rules; summaries and facts are never manually or randomly generated.

**Acceptance Scenarios**

1. A compaction job is eligible only when one of the configured deterministic thresholds is crossed.
2. Initial thresholds are recorded in code before implementation and tests pin them; the starting policy is: at least 24 eligible older messages outside the maximum recent-turn window or at least 6,000 estimated context units of unsummarized older content.
3. A summary covers one contiguous immutable older-message range ending before the maximum recent-turn window.
4. New messages outside a completed summary's covered range do not make that summary stale.
5. A summary becomes stale only when its covered visible message set changes, an active retry selection inside the range changes, a covered message is deleted, or the summarizer version changes.
6. Summary and durable-fact extraction happen in one isolated internal Qwen compaction request with a reset native context; the request and its output never enter visible conversation history.
7. Durable facts include source-message links, normalized keys and lifecycle state; duplicates are merged and newer contradictory facts supersede older facts without deleting their history.
8. Compaction never runs concurrently with visible answer generation, embedding generation, recording or transcription.
9. If compaction is pending, the user can still receive an answer using exact turns, retrieval and any previously valid summary.

---

### User Story 5 — Image evidence reuse and lifecycle (Priority: P2)

A user can ask multiple questions about the same image without Locra repeatedly running the original image through the vision pipeline.

**Acceptance Scenarios**

1. A physical image is stored once as an image asset and may be linked to one or more messages.
2. Structured visual evidence is stored with the source message, image asset and evidence version.
3. Follow-up questions reuse stored evidence and do not reprocess the original image when that evidence is sufficient.
4. A newly attached image becomes the default active image, while an explicit reference can resolve an earlier image.
5. If the original file is missing but evidence exists, evidence may answer non-pixel-dependent follow-ups; pixel-dependent requests report that the original image is unavailable.
6. Deleting a message removes its message-image link and derived evidence; the physical file is deleted only when no remaining message references the asset.

---

### User Story 6 — Per-conversation Low, Medium and High modes (Priority: P2)

Each conversation can use its own response depth without changing the model or affecting other conversations.

**Acceptance Scenarios**

1. Every conversation stores one response mode: Low, Medium or High.
2. A newly created conversation starts with the user's global default; Medium is the initial global default.
3. Changing the mode updates only the active conversation and affects only future requests.
4. Changing mode does not rewrite messages, regenerate embeddings, invalidate summaries or lose drafts/images.
5. Each mode uses the same Qwen model and defines monotonic values for recent exact turns, context budget, retrieval limits, answer target and generation limit.
6. The selected mode is visible and changeable from the chat UI.

---

### User Story 7 — Explicit retrieval from one past conversation (Priority: P3)

A user can ask Locra to use a specific earlier chat, such as an SSD chat or Niagara trip chat, without enabling automatic search across unrelated conversations.

**Acceptance Scenarios**

1. Cross-chat retrieval is off by default.
2. The user may select a past chat through a chat picker or explicitly name one in the request.
3. Candidate resolution uses bounded conversation metadata search over normalized title keywords and dates and returns at most 10 candidates.
4. If exactly one conversation is resolved confidently, retrieval is restricted to that stable conversation ID.
5. If multiple conversations match, Locra requires user selection and performs no content retrieval until selection.
6. This feature targets one selected past conversation per request; unrestricted "search all chats" is outside this feature.
7. Retrieved items preserve source conversation/message/image/timestamp references and are request-scoped.
8. Past-chat content is never permanently merged into the active conversation's summary, durable facts or active image state.

---

### User Story 8 — Fully offline voice input (Priority: P3)

A user can record speech, receive editable local transcription and explicitly submit it through the same pipeline as typed text.

**Acceptance Scenarios**

1. Voice is disabled until the user explicitly enables it.
2. Before first use, Locra shows the voice model's storage requirement and downloads/verifies it locally.
3. Recording, transcription and answer generation work with the device offline after model setup.
4. The transcript is placed into the existing editable draft and is never auto-submitted.
5. Submitted voice text follows the same SQL, context, retrieval, summary, response-mode and Qwen path as typed text.
6. The device resource policy permits only one of these states at a time: Qwen answer/compaction, embedding generation, voice recording or voice transcription.
7. Starting recording while another protected operation is active is blocked with a clear status; protected operations cannot begin while recording is active.
8. Cancellation and permission/model failures return the UI to a clean editable state.

## Edge Cases

- Empty conversations use only the current request and attachment.
- A retry may complete after an earlier attempt failed; only the explicitly active completed attempt enters context.
- If every assistant attempt for a user message failed or was interrupted, no assistant response for that user message enters normal context.
- Long messages are stored unchanged and split only into derived searchable chunks (initial deterministic chunking: maximum **800 characters** per chunk with **120-character overlap**, versioned via `chunk_version`; short messages remain a single searchable unit).
- Embedding model/version changes invalidate derived vectors and trigger bounded rebuilding.
- Retrieval with no candidate above threshold adds no filler.
- A valid older-range summary remains valid when unrelated new turns are appended outside its range.
- An active retry change inside a summarized range invalidates that summary and facts derived from the superseded visible attempt.
- Missing image files never cause another image to be silently substituted.
- Ambiguous chat names open a bounded picker rather than guessing.
- A deleted selected chat causes the request to continue without cross-chat context and displays a clear notice.
- Voice model download or permission failure does not modify the current draft.
- Database schema changes during development may trigger a clearly documented destructive SQL reset.

## Functional Requirements

### SQL persistence and bounded memory

- **FR-001**: SQL MUST be the canonical store for conversations and derived context data.
- **FR-002**: The system MUST support at least 200 conversations and long chats with hundreds of messages.
- **FR-003**: Conversation and message access MUST use indexed keyset pagination with stable timestamp-plus-ID cursors.
- **FR-004**: Interactive pages MUST contain at most 50 records.
- **FR-005**: The UI/store layer MUST maintain a bounded page cache and MUST NOT accumulate the full database in Zustand.
- **FR-006**: Development builds MAY reset SQL on incompatible schema changes; production-grade MMKV history migration is out of scope.
- **FR-007**: Existing non-history settings MAY remain in MMKV.

### Immutable messages and attempts

- **FR-008**: Submitted user message text MUST be immutable.
- **FR-009**: Assistant text MAY change only while the attempt is `generating`.
- **FR-010**: Terminal assistant attempts MUST be immutable.
- **FR-011**: Retry MUST create a new assistant attempt linked to the original user message.
- **FR-012**: Exactly one assistant attempt MAY be marked active for a user message.
- **FR-013**: Normal visible/model context MUST include user messages and active completed assistant attempts only.
- **FR-014**: Failed, interrupted and superseded attempts MUST remain stored but excluded from normal context.

### Hybrid retrieval and embeddings

- **FR-015**: Context priority MUST follow the order defined in User Story 3.
- **FR-016**: Scope filtering MUST occur before similarity scoring.
- **FR-017**: Retrieval MUST use deterministic thresholds, limits, deduplication and tie-breaking. The cosine similarity threshold is a versioned retrieval constant pinned at an initial value of **0.62**; it MAY change only through recorded evaluation, never silently.
- **FR-018**: Every embedding MUST record the exact model ID, model artifact version/hash, dimensions, source revision and state.
- **FR-019**: Embeddings MUST be replaceable derived data and rebuilt in bounded batches.
- **FR-020**: The app MUST retain deterministic lexical/exact fallback while embeddings are missing, stale or failed.
- **FR-021**: A specific embedding artifact, license, URL, size and SHA-256 manifest MUST be approved before implementation of the embedding runtime.

### Images

- **FR-022**: Physical image assets MUST be separated from message-image links.
- **FR-023**: Evidence MUST retain source conversation, message, image asset and evidence-version references.
- **FR-024**: Existing evidence MUST be reused for appropriate follow-ups without reprocessing.
- **FR-025**: Physical image deletion MUST occur only after no message link remains.

### Summaries and durable facts

- **FR-026**: Compaction triggers MUST be fixed, automatic and test-pinned.
- **FR-027**: Summaries MUST cover contiguous older-message ranges and retain source boundaries and source-view hash.
- **FR-028**: New messages outside the covered range MUST NOT stale a summary.
- **FR-029**: Summary/fact generation MUST use an isolated internal Qwen request and never enter visible history.
- **FR-030**: Durable facts MUST retain one or more source-message links, normalized key, extraction version and lifecycle state.
- **FR-031**: Contradictory newer facts MUST supersede rather than erase older facts.
- **FR-032**: Compaction MUST use the shared resource policy and MUST NOT block answering when valid fallback context exists.

### Per-conversation response modes

- **FR-033**: Every conversation MUST persist one Low/Medium/High mode. Modes MUST be stored lowercase (`low`/`medium`/`high`) in SQL and mapped to the runtime `Low`/`Medium`/`High` representation through one tested conversion function.
- **FR-034**: New conversations MUST copy the global default mode at creation; initial default is Medium.
- **FR-035**: Mode changes MUST affect only future requests in that conversation.
- **FR-036**: Modes MUST use the same model and differ only by bounded context/retrieval/generation configuration. Context budget "units" are character-based estimates measured by the existing `CharacterContextBudgetPolicy` (message text length), NOT tokenizer tokens.

### Explicit past-chat targeting

- **FR-037**: Cross-chat retrieval MUST require an explicitly resolved single target conversation.
- **FR-038**: Candidate lookup MUST be bounded to at most 10 metadata candidates.
- **FR-039**: Ambiguity MUST require user selection before content retrieval.
- **FR-040**: Targeted content MUST be request-scoped and source-attributed.
- **FR-041**: Automatic or unrestricted all-chat vector retrieval is out of scope.

### Voice and resource safety

- **FR-042**: Voice transcription MUST be fully on-device after explicit model setup.
- **FR-043**: Voice model/runtime selection MUST pass API, license, New Architecture, memory and NDK-26 verification before implementation.
- **FR-044**: Transcription MUST write editable draft text and MUST never auto-submit.
- **FR-045**: Qwen answer/compaction, embedding generation, recording and transcription MUST be mutually exclusive protected operations.
- **FR-046**: All inference, retrieval, storage, summary and voice paths MUST remain offline after required local models are installed.

### Evaluation

- **FR-047**: Baselines MUST be recorded before replacing MMKV/lexical context.
- **FR-048**: Evaluation MUST cover short chat, long chat, image follow-ups, retries, selected past-chat retrieval, all modes, voice, memory, storage and latency.
- **FR-049**: The new pipeline MUST not regress existing short-chat and first-image-answer quality.

## Key Entities

- Conversation
- Immutable message
- Assistant retry attempt
- Image asset
- Message-image link
- Visual evidence
- Search chunk
- Versioned embedding
- Older-range summary
- Durable fact and fact-source link
- Request-scoped conversation target
- Per-conversation response mode
- Voice model state and editable transcript
- Evaluation case

## Success Criteria

- **SC-001**: First conversation page appears within 1.5 seconds on the target device with 200 conversations.
- **SC-002**: First message page appears within 1 second and subsequent pages within 500 milliseconds.
- **SC-003**: The UI cache never exceeds its configured page/message bounds during long-history scrolling tests.
- **SC-004**: Completed content is never overwritten; retries produce separate persisted attempts in 100% of retry cases.
- **SC-005**: Normal model context contains zero failed, interrupted or superseded assistant attempts.
- **SC-006**: Long-chat retrieval improves required earlier-information recovery over baseline without short-chat regression.
- **SC-007**: Same inputs produce identical context source selection and ordering.
- **SC-008**: Image follow-ups reuse stored evidence in 100% of applicable tests.
- **SC-009**: Summary jobs run only at pinned triggers and new turns outside a covered range do not invalidate the summary.
- **SC-010**: Targeted cross-chat retrieval searches only the selected conversation and produces zero unrelated-chat leakage.
- **SC-011**: Each conversation retains its own mode and switching modes preserves all existing state.
- **SC-012**: Voice works offline, never auto-submits and causes zero protected-operation overlap.
- **SC-013**: Retrieval/assembly completes within 1.5 seconds for active chat and 2 seconds for a selected past chat over the evaluation dataset.
- **SC-014**: Deleting a conversation leaves zero database or image-file orphans.
- **SC-015**: Zero network calls occur in normal persistence, retrieval, embedding, compaction, voice transcription, image understanding or answer generation. This is enforced by an automated architecture guard (persistence/retrieval/embedding/compaction/voice modules MUST NOT import or call networking modules) plus final airplane-mode device validation.

## Assumptions

- Existing development history may be discarded during the SQL cutover.
- SQL becomes canonical immediately; MMKV continues only for small settings such as the global default response mode.
- The existing Qwen/llama.rn answer pipeline and vision evidence format remain authoritative.
- Embedding and voice runtimes remain provisional until their verification gates pass.
- Only one explicitly selected past chat can be targeted per request in this feature.
- User-message editing/branching and unrestricted all-chat search are deferred.
- Performance testing targets Android devices with 6–8GB RAM.