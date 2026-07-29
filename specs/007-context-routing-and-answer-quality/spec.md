# Feature Specification: Context Routing and Answer Quality

**Feature Branch**: `007-context-routing-and-answer-quality`

**Created**: 2026-07-26

**Status**: Architecture Revision Draft (2026-07-28)

**Input**: User description: "Create a context router that selects the smallest useful context for each request, improving normal text conversations, long multi-turn conversations, new/follow-up image questions, OCR/counting/price/detailed-visual questions, voice-transcribed questions, optional cross-chat context sharing, and answer relevance/conciseness/grounding/repetition — incrementally, on top of the existing Spec 006 architecture."

## 1. Problem and Goals

**Architecture revision input (2026-07-28)**: Redesign Spec 007 as one
coordinated, model-independent turn-planning, semantic-retrieval,
conversation-memory, and multimodal-inference architecture, while preserving
canonical SQLite messages and migrating incrementally from the current
implementation. This revision is authoritative where it conflicts with the
original input statement above.

Spec 006 and the first Spec 007 implementation built a deterministic
hybrid-context pipeline (`ContextOrchestrator`, `HybridRetriever`,
`EmbeddingService`, `ImageEvidencePolicy`, `AnswerPostProcessor`). Physical
device diagnostics then showed that the remaining failures are architectural,
not isolated prompt defects:

- **The router always assembles the same fixed set of sources.** `ContextOrchestrator.orchestrate()` unconditionally attempts recent turns, media evidence, same-chat retrieval, durable facts, and an older-range summary for every request, regardless of whether the request is independent and self-contained. There is no classification step that decides "this request needs none of that."
- **Semantic retrieval is wired but inert in production.** `HybridRetriever` and `EmbeddingService` exist and are unit-tested, but no caller ever produces a query-time vector (`ContextOrchestrationOptions.queryVector` is never populated outside tests) and the runtime orchestrator is built with no embedding manifest. Every retrieval call in the shipped app silently falls back to lexical-only matching. Likewise, `ImageEvidencePolicy.evaluateImageEvidenceAvailability` — the pure function that should decide "re-run the original image through the Qwen vision path" vs. "reuse stored evidence" vs. "original unavailable" for pixel-dependent questions (OCR, counting, prices, detailed visual reads) — is fully tested but never called from `ContextOrchestrator`.
- **Context budgeting is character-only, not model/token-aware.** `ContextOrchestrator`'s `CharacterContextBudgetPolicy` measures raw character counts (`contextBudgetUnits` of 4,000 / 7,000 / 11,000 for Low/Medium/High) to decide what the router includes, while a separate, later trimming pass (`ContextWindow.trimMessagesToContextWithReport`) estimates actual tokens (`Math.ceil(length / 3)`) against the real Qwen context window (`QWEN_CONTEXT_TOKEN_LIMIT` = 4096 tokens, minus the generation reserve). These two measurements are not calibrated against each other, and neither reserves distinct capacity for system instructions, current input, image input, selected context, and generated output — so the router can select a source set that fits its own character budget yet still gets silently re-trimmed downstream against the real token limit.
- **Cross-chat context was removed, not deferred.** Spec 006 Phase 13 (T100) deliberately removed all alternate-conversation selection from the UI, requests, stores, retrieval budgets, and evaluation cases because the one-chat-at-a-time picker leaked complexity and correctness risk. There is currently no path — opt-in or otherwise — for relevant context to cross conversation boundaries.
- **Answer-quality control stops at post-hoc repetition and truncation cleanup.** `AnswerPostProcessor` reliably catches literal looping and mid-sentence truncation after the fact, but generation itself has no task-sensitive length targeting beyond the three response modes, and nothing stops an emerging loop earlier during generation.
- **Semantic authority is fragmented.** Request classification, context
  orchestration, generation planning, vision execution, `InferenceQueue`,
  refusal recovery, and grounding can independently infer intent, modality,
  dependency, image strategy, and retrieval requirements. Their decisions can
  disagree within one turn.
- **A single classification error has excessive blast radius.** The current
  independent-question gate can disable recent context, retrieval, facts,
  summaries, image continuity, and explicit memory together.
- **Memory and evidence arrive too late or with the wrong authority.** Explicit
  user memories may wait for compaction, normal direct-image turns may leave no
  reusable structured evidence, and refusal-like assistant prose can contaminate
  later reinspection.
- **Regex is carrying semantic responsibility it cannot reliably satisfy.**
  Pronouns, comparisons, implicit memory recall, active-topic continuity, and
  image references require semantic and stateful signals rather than another
  pattern patch.

**Goals** — improve, without a rewrite:

- Normal text conversations receive only what they need, not the full fixed source set; independent, self-contained questions receive no unrelated history, facts, summaries, or image context unless the request contains a genuine reference to prior context.
- Long multi-turn conversations stay coherent and within budget as they grow.
- New image questions get correctly evidenced answers.
- Follow-ups about the current or an explicitly referenced older image resolve to the correct image, never a silently substituted one; a genuinely ambiguous image reference never silently guesses among older images.
- OCR, counting, price, label, and other detailed-visual questions trigger genuine re-inspection — the correct original local image passed through the Qwen multimodal vision path again — instead of stale evidence reuse when the original is available. Selecting an image ID or reusing stored evidence alone is never sufficient for these requests.
- Voice-transcribed questions are routed identically to typed text once transcribed.
- Users who explicitly opt in can get relevant context shared across their own chats, with per-conversation exclusion and zero leakage when the setting is off (the default) — delivered as a later, self-contained phase once same-chat routing, image continuity, and token budgeting are stable.
- Answers become more relevant, more concise for simple questions, longer only when the task needs it, less repetitive, and stop looping earlier — using runtime-verified generation controls — with deterministic grounding/hallucination checking available as a final, optional diagnostics-only phase.

- Every turn produces one authoritative, validated structured plan (`TurnPlan`)
  that downstream modules execute without independently reclassifying intent,
  modality, dependency, references, retrieval scope, vision strategy, memory
  operations, or generation requirements.
- No single low-confidence semantic decision can erase an explicitly attached
  image, direct reference, explicit durable-memory write, or another
  independently established context requirement.
- Explicit user memories become available immediately. Episodic units, segment
  summaries, durable facts, conversation-state ledger entries, and structured
  image evidence remain provenance-bearing derived layers over canonical SQLite
  messages.
- EmbeddingGemma is the first planned semantic provider behind a
  model-independent `EmbeddingProvider` boundary and versioned index lifecycle.
- The current Qwen3-VL runtime remains unchanged in this phase behind a
  model-independent main inference boundary, so a later compatible provider can
  be substituted without redesigning planning, memory, retrieval, evidence,
  context ranking, storage, or diagnostics.

## 2. Non-Goals

- Rewriting or replacing SQL persistence, the immutable-message/retry-attempt model, the Qwen/llama.rn answer or vision pipelines, or the compaction/summary job — all established in Spec 006 and left in place.
- Introducing a second conversation store, a second inference queue, or any cloud/network processing anywhere in this feature (Constitution I/II/VIII).
- Reintroducing the removed per-message "select a past chat" picker UX (Spec 006 Phase 13, T100). Any cross-chat behavior in this feature is opt-in, global-by-default-off with per-conversation exclusion, and automatic — not a manual per-request picker.
- Implementing live/partial voice transcription. Voice input remains offline whisper.rn record-then-transcribe as already gated behind `VOICE_INPUT_ENABLED`; this feature only ensures transcribed text is routed like any other text input.
- Building a general-purpose retrieval system over arbitrary external documents, files, or the web; adding PDF/document attachment support; or adding live camera analysis. Retrieval scope is limited to this device's own conversation history (current chat, and opted-in, non-excluded other chats); attachments remain single-image, exactly as today.
- Supporting multiple simultaneous image attachments on one message. This feature's older-image/same-image/ambiguous-reference handling assumes the existing one-image-per-message model.
- Changing response-mode generation limits, the model, or the inference runtime wholesale. Modes (Low/Medium/High) keep their existing relative ordering; this feature changes what feeds those budgets, how those budgets are measured, and layers classification-aware refinements on top — not the underlying model or runtime.
- Selecting or approving the production embedding model artifact. That approval gate (manifest hash, license, device-compatibility verification) predates this feature and remains a separate, recorded decision this feature does not make and does not assume has already happened.
- Shipping cross-chat retrieval (Section 7) or the deterministic grounding/hallucination assessment (Section 9, final phase) in the first delivery slice. Both remain in this feature's scope, but are explicitly sequenced as later, optional phases (Section 14) after routing, image continuity, token budgeting, and generation/repetition improvements are stable — neither may block or be a prerequisite for the earlier phases, and neither is part of this feature's core acceptance criteria or core required tests (Section 12).
- A broad UI redesign, a new model marketplace, or any other feature not explicitly named in this specification. New UI is limited to a single global cross-chat-memory setting, a per-conversation cross-chat-exclusion control, and diagnostics fields already covered by the existing beta diagnostics export — all built from the existing design system (see Preserved Foundations).

- Replacing the current production Qwen model in this phase. Only the
  model-independent capability boundary, provider descriptor, and migration
  validation are specified.
- Treating EmbeddingGemma as an answer model, pixel-inspection model, source of
  reliability, or sole retrieval mechanism.

## 3. Conversation Scenarios

### User Story 1 — Independent, self-contained questions receive zero conversational context (Priority: P1)

A user asks a question with no genuine reference to anything earlier — no pronoun, no "it"/"that", no continuation language — in a conversation that already has unrelated history, durable facts, a summary, or an attached image.

**Acceptance Scenarios**

1. Given a conversation with prior unrelated turns, durable facts, a rolling summary, and an unrelated attached image, when the user asks a self-contained question, then the validated plan selects no irrelevant prior source. An incorrect legacy independent classification cannot suppress an exact explicit-memory match, exact same-chat lexical match, directly referenced entity, attached image, explicit image reference, explicit user fact, or active comparison target.
2. Given the same conversation, if the question instead contains a genuine reference to prior context (e.g., "and what about the second one", "does that still apply"), it is classified as a text follow-up, not an independent question, and may receive recent turns.
3. Diagnostics distinguish eligible/considered sources from selected sources. Irrelevant sources are not selected, while the bounded independent-routing recovery in FR-086 may consider protected exact/direct candidates before planner authority transfers.

---

### User Story 2 — Text follow-ups use only what the reference requires (Priority: P1)

A user asks a follow-up that depends on the immediately preceding exchange.

**Acceptance Scenarios**

1. Given a conversation where the previous turn established relevant context, when the user asks a follow-up carrying a genuine reference to prior context, then the router includes the recent turns needed to resolve that reference, without pulling in unrelated older material, retrieval, or image evidence unless the follow-up also references those.
2. A follow-up that only needs the immediately preceding turn does not trigger same-chat retrieval or summary inclusion just because they exist elsewhere in the conversation.

---

### User Story 3 — Long-context retrieval requests stay coherent and bounded (Priority: P1)

A user continues a conversation past the recent-turn window and asks about something from earlier.

**Acceptance Scenarios**

1. Given a conversation longer than the mode's recent-turn floor, when the user asks a question classified as a long-context retrieval request, then the router includes durable facts and/or the older-range summary and/or same-chat retrieved items relevant to the question, prioritized under recent exact turns and the current request.
2. Given the same conversation, when the user asks an independent text question unrelated to earlier content, no unrelated older material is added merely because the conversation is long.
3. Repeating the same request against identical stored state, response mode, and embedding version produces identical source selection and ordering.

---

### User Story 4 — New image questions are fully evidenced (Priority: P1)

A user attaches a new image and asks about it.

**Acceptance Scenarios**

1. Given a message with a newly attached image, when the user asks any question about it, then the router classifies the request as a new image question and includes the resulting visual evidence in context.
2. The new image becomes the conversation's default active image for subsequent follow-ups.

---

### User Story 5 — Same-image follow-ups reuse evidence when sufficient (Priority: P1)

A user asks multiple non-pixel-dependent questions about the same image without re-attaching it.

**Acceptance Scenarios**

1. Given a prior image turn with stored evidence, when the user asks a same-image follow-up that is not pixel-dependent, then the router reuses stored evidence and does not reprocess the original image.
2. Given the same setup, when the follow-up carries no visual language and no reference to the image, the router does not attach image evidence just because an image exists in the conversation — it is classified as an independent text question or text follow-up instead.

---

### User Story 6 — Older-image and ambiguous-image references resolve without silent substitution (Priority: P2)

A user has attached multiple images across a conversation and asks about an earlier one, or asks about "the image" when it is unclear which one is meant.

**Acceptance Scenarios**

1. Given two or more images in one conversation, when the user unambiguously references an earlier image (by an ordinal, description, or other disambiguating detail), then the request is classified as an older-image reference and the router resolves evidence/original for that specific image, never a different one.
2. Given the referenced image's original file is missing but its evidence still exists, when the follow-up is not pixel-dependent, then stored evidence answers the question and the response does not claim to have re-inspected the original.
3. Given the referenced image's original file is missing and the follow-up is also classified as pixel-dependent, then the response reports the original as unavailable rather than answering from stale evidence.
4. Given two or more images exist and the reference could plausibly mean more than one of them with no uniquely strongest deterministic or semantically supported match, then the reference remains `unresolved-reference` and execution requests clarification. No image, pixels, or stored evidence is presented as belonging to the requested image until resolution succeeds.

---

### User Story 7 — Pixel-dependent visual requests re-run the correct original image through the Qwen vision path (Priority: P1)

A user asks a question that depends on precise pixel content (reading text, counting items, reading a price, reading a label, identifying fine visual detail) about an image already evidenced earlier in the conversation.

**Acceptance Scenarios**

1. Given existing stored evidence for an image and the original asset is still available, when the user asks a pixel-dependent visual request (e.g., "how many are in the box", "what does the label say", "what's the price"), then the router causes the correct original local image file to be passed through the Qwen multimodal vision path again — producing fresh visual evidence for this request — rather than answering from the existing stored evidence text alone. Selecting the image's ID or reusing stored evidence without re-running vision inference is never sufficient for a pixel-dependent request.
2. Given the same pixel-dependent request but the original asset is missing, then the response reports that the original image is unavailable instead of guessing from evidence.
3. This applies identically whether the pixel-dependent request concerns the current active image (Story 5's image) or an unambiguously referenced older image (Story 6).

---

### User Story 8 — Voice-transcribed questions route like typed text (Priority: P3)

A user records a voice message; it is transcribed into the editable draft and submitted.

**Acceptance Scenarios**

1. Given a transcribed and submitted voice message, the router applies the same classification, retrieval, image-reference, and budget rules as it would to typed text with identical content.
2. No voice-specific bypass or special-casing exists in the router; transcription quality is outside this feature's scope.

---

### User Story 9 — Cross-chat context only when explicitly enabled, delivered as a later phase (Priority: P3)

A user turns on a global setting to let relevant content from their other local conversations inform answers. This capability is scoped for delivery after same-chat routing (Stories 1–3), image continuity (Stories 4–7), and token budgeting (Section 8) are stable (Section 14, Phase 7) — validated same-chat semantic retrieval (Section 6) is a further prerequisite since cross-chat scope extends the same retrieval path.

**Acceptance Scenarios**

1. By default (setting off), no request in any conversation ever includes content from another conversation.
2. After the user enables the setting, a request classified as cross-chat-eligible that has relevant content in another local, non-excluded chat may include that content as clearly source-attributed, untrusted retrieved text, scoped by the same relevance rules as same-chat retrieval.
3. After the user disables the setting again, the very next request in every conversation stops including cross-chat content, with no app restart required and no data loss.
4. Given cross-chat sharing is enabled globally, when a specific conversation is marked excluded from cross-chat retrieval, that conversation's content is never surfaced to other chats and that conversation never receives cross-chat content from others.

---

### User Story 10 — Generation stays concise, avoids repetition, and stops loops earlier (Priority: P2)

A user receives an answer that would otherwise loop, run long, or pad unnecessarily; a user asking a genuinely detailed question still gets the length that question needs.

**Acceptance Scenarios**

1. Given a request classified as an independent text question or text follow-up with an objectively short expected answer, the applied output-length target favors the shortest complete answer rather than the response mode's full soft target merely because a longer mode is selected.
2. Given a request that genuinely needs a longer answer (e.g., a long-context retrieval request or a High-mode request asking for a detailed explanation), the output-length target is not artificially shortened — length follows task need, not a blanket reduction.
3. Given a raw answer that begins to loop, generation stops at or near the point the loop is detected — using whatever repetition/stopping controls the currently linked Qwen/llama.rn runtime actually supports, verified and manually validated rather than assumed — rather than continuing to the hard token limit and being cleaned up only afterward.
4. Existing truncation/looping post-processing continues to run as a safety net and MAY be improved (e.g., earlier detection, adjusted thresholds) without being required to stay identical to today's implementation.
5. If generation is interrupted (loop-stopped, cancelled, or failed), partial text already produced is preserved exactly as Spec 006's existing checkpoint/recovery behavior already guarantees — this feature does not weaken that guarantee.

**Note (not a core acceptance criterion)**: A later, optional, diagnostics-only phase (Section 14, Phase 8) may add a deterministic grounding/hallucination assessment. It is intentionally excluded from this story's core acceptance criteria and from Section 12's required automated tests — see Section 9 and Section 14.

### Edge Cases

- A short, ambiguous reply with no explicit reference word (e.g., a bare "why?" or "are you sure?") is, by default, conservatively classified as a text follow-up rather than an independent text question, since defaulting to zero context risks breaking a legitimate continuation.
- The router's token-budget estimate and the existing downstream hard trim (`ContextWindow`) disagree: the router's own accounting MUST NOT allow a source set that the downstream trim would still need to silently cut; the two measurements are reconciled (Section 8).
- Embedding backfill is incomplete, in progress, or a generation call fails when a request arrives: retrieval falls back to lexical-only rather than waiting or failing.
- The cross-chat setting is toggled mid-conversation: the change applies starting with the very next request, not retroactively to context already assembled for an in-flight generation.
- A conversation is marked excluded from cross-chat while cross-chat is globally enabled: it behaves as fully isolated in both directions (neither contributing to nor receiving cross-chat content).
- An image is deleted (and its evidence removed per Spec 006 lifecycle rules) after a follow-up references it: the router treats it as unavailable, matching existing missing-file handling — never substituting a different image.
- An image reference is genuinely ambiguous among two or more prior images after candidate construction finds no uniquely supported result: the planner records `unresolved-reference` and requires clarification. It does not select an image, pixels, or evidence. The active image is selected only when the request semantically refers to that active visual entity and no other candidate is materially plausible.
- A pixel-dependent request arrives while the single-flight inference queue is busy: it queues normally like any other inference request; it receives no special priority.
- Fusing lexical and semantic candidates produces overlapping results for the same source message: the router dedupes by source message, keeping the higher-ranked fused result; an exact match on a number, price, date, or identifier is never dropped by fusion (Section 6).
- A voice transcript is garbled or ambiguous: the router treats it as ordinary text; no confidence signal changes routing in this feature (see Open Questions).
- Both an explicitly referenced image and a top cross-chat retrieved item would fit only one of them within budget: the explicitly referenced image is protected and always wins (Section 8).
- Cross-chat scope is enabled but the device has zero other eligible (non-excluded) conversations: retrieval behaves exactly as same-chat-only, with no error.
- An unrelated question is asked immediately after an image turn: the previous turn's image evidence is not carried into the answer unless the new question is itself classified as an image-related or follow-up request (Section 4).
- A request combines multiple classifications (e.g., an older-image reference that is also pixel-dependent, or a long-context retrieval request that is also a same-image follow-up): all applicable sections' rules apply together, budgeted per Section 8's protection order.

## 4. Context-Routing Requirements

- **FR-001**: A single context router MUST decide, per request, which of the eight context sources (recent exact turns, rolling summary, structured facts, original image reuse, stored visual evidence, lexical retrieval, semantic retrieval, cross-chat memory) are included, replacing `ContextOrchestrator`'s current behavior of always attempting every applicable source.
- **FR-002**: The router MUST classify each request, using deterministic signals available at request time (message text, presence or absence of a genuine reference to prior context such as pronouns and continuation phrases, attachment presence, explicit image reference, conversation length relative to the response mode's recent-turn floor, and the cross-chat setting/exclusion state), into the following categories — no network call and no additional model-inference request solely for classification:
  - **independent text question** — no genuine reference to prior turns, facts, summaries, or images;
  - **text follow-up** — a genuine reference to the immediately preceding exchange or nearby recent turns;
  - **new image question** — the current message itself carries a newly attached image;
  - **same-image follow-up** — refers to the conversation's current/active image without attaching a new one, with no material ambiguity among multiple image candidates;
  - **older-image reference** — unambiguously references an earlier, non-active image;
  - **pixel-dependent visual request** — OCR/text-reading, counting, price-reading, label-reading, or other detailed-visual-inspection language; may combine with any image classification above;
  - **long-context retrieval request** — the conversation exceeds the response mode's recent-turn floor and the question plausibly concerns earlier content;
  - **cross-chat-eligible request** — the cross-chat setting is enabled, the current conversation is not excluded, and the request is otherwise eligible for expanded scope (Section 7).

  A single request MAY carry more than one applicable classification at once (e.g., an older-image reference that is also pixel-dependent); the source-selection rules in Sections 5–8 key off the full applicable combination, not a single exclusive label.
- **FR-003 (HISTORICAL; absolute behavior superseded by FR-061 and FR-086)**: The completed first architecture gave a pure independent classification only the current request. That absolute hard skip MUST NOT remain authoritative: before unified-planner authority, the bounded recovery in FR-086 protects exact/direct sources; afterward, each `TurnPlan` field independently determines eligibility. Irrelevant context still MUST NOT be selected.
- **FR-004 (HISTORICAL; independent-turn clause superseded by FR-086)**: Current request and applicable required recent turns retain priority over retrieved or summarized sources. The former rule that a pure independent classification has no opportunity to recover any prior source is superseded; required exact/direct candidates survive through FR-086 and later through the authoritative `TurnPlan`.
- **FR-005**: Retrieval (lexical, semantic, or cross-chat) MUST be added to context only when at least one candidate meets the existing relevance threshold (lexical overlap greater than zero, or cosine similarity at or above `COSINE_SIMILARITY_THRESHOLD`); the router MUST NOT inject filler content when no candidate qualifies.
- **FR-006 (clarified)**: Application-state evaluation, ledger evaluation, exact/lexical retrieval, candidate construction and ordering, plan validation, safe fallback, context ranking, and post-processing MUST be deterministic for identical versioned inputs. A constrained model result is not required to be byte-for-byte deterministic; its invocation gate, schema validation, bounded-enum interpretation, and post-processing MUST be deterministic (FR-091–FR-093).

## 5. Image-Reference Requirements

- **FR-007**: The router MUST invoke image-evidence-availability resolution (extending `ImageEvidencePolicy.evaluateImageEvidenceAvailability`, which exists today but is not called from `ContextOrchestrator`) for every request carrying a new-image, same-image, older-image, or pixel-dependent classification, rather than leaving that decision unused.
- **FR-008**: "Use the original image" MUST mean the correct original local image file is passed through the Qwen multimodal vision path (via the existing `llama.rn` inference pipeline) again, producing fresh visual evidence for the current request. Selecting an image's ID, or reusing previously stored evidence text without re-running vision inference, is never sufficient to satisfy a pixel-dependent request.
- **FR-009**: A request classified as pixel-dependent MUST trigger the original-image re-inference behavior in FR-008 when the original asset is available, even when sufficient stored evidence already exists.
- **FR-010**: A follow-up MUST resolve to the correct image: the active image
  only for an unambiguous semantic reference to the active visual entity, or the
  specific uniquely resolved older image. It MUST NOT silently substitute a
  different image.
- **FR-011**: When the required original image is unavailable and the request is pixel-dependent, the router MUST cause the response to report the original as unavailable rather than answering from stale evidence or a substituted image.
- **FR-012**: When the required image is unavailable and the request is not pixel-dependent, stored evidence MAY answer the question if it is sufficient, consistent with existing Spec 006 evidence-reuse behavior.
- **FR-012a (SUPERSEDED at this original requirement location)**: The earlier requirement mapped unresolved image ambiguity to the active image. That behavior is prohibited. An ambiguous reference with multiple materially plausible candidates MUST produce `unresolved-reference` with `clarificationRequired: true`, MUST select no image, and MUST present no original pixels or stored evidence as belonging to the requested image until resolution succeeds. Selecting the active image is valid only when the request semantically refers to the active visual entity and is not ambiguous between multiple candidates (see FR-049 and FR-087).

## 6. Semantic and Hybrid Retrieval Requirements

- **FR-013**: The router MUST support three retrieval states per request: fused hybrid (embeddings available, fresh, and compatible with the current scope), lexical-only fallback (embeddings unavailable, stale, incompatible, still building, or a query-embedding call fails at runtime), and no-retrieval (no candidate meets the relevance threshold, or retrieval was not selected for this request). Any embedding failure MUST degrade to lexical-only fallback, never to a failed request.
- **FR-014**: When both lexical and semantic candidates are available, the router MUST fuse them into one ranked candidate list using one deterministic fusion-and-reranking method — combining lexical-overlap and cosine-similarity signals, deduplicating by source message, and keeping the higher-ranked instance — rather than letting semantic scoring silently discard an exact lexical match that the lexical-only path would have surfaced. Fusion MUST NOT replace or hide an exact lexical match on a name, number, price, date, or other identifier-like token present in the query (see FR-019a).
- **FR-015**: Query-time embedding generation MUST be added so `HybridRetriever` actually receives a query vector when the embedding runtime is active. Today no caller populates `ContextOrchestrationOptions.queryVector` in production, so hybrid retrieval always falls back to lexical-only regardless of embedding availability.
- **FR-016**: Semantic retrieval activation MUST remain gated behind the existing embedding-artifact approval process — covering model identity, license, artifact hash, dimensions, latency, memory, and device-compatibility verification, as established for this project. This feature defines and wires the routing, fusion, and query-time embedding path; it does not itself grant that approval, and no artifact of this feature may assert or imply that an embedding runtime is currently approved when it is not.
- **FR-017**: Embedding backfill MUST continue to run under the existing exclusive device resource policy (never concurrent with answer generation, compaction, or voice) and MUST NOT block answering — a request MUST use lexical fallback while backfill is incomplete.
- **FR-018**: Hybrid retrieval MUST support an expanded scope (current chat, plus opted-in, non-excluded cross-chat sources per Section 7) using the same scope-filter-before-scoring rule already required for same-chat retrieval, so enabling cross-chat scope never changes single-chat-only retrieval results when cross-chat is off.
- **FR-019**: Retrieved items from any scope MUST remain source-attributed
  conversation data. Relevant factual details remain usable for explicit memory
  questions, while any instructions quoted inside retrieved text are
  non-authoritative and MUST NOT be followed.
- **FR-019a**: A lexical candidate containing a verbatim (case-insensitive) match for a number, price-like token, date-like token, or the query's likely proper-noun/identifier token MUST be included in the final fused result set — subject to the existing per-request retrieval limit and token budget — regardless of its computed fused rank, so the deterministic fusion method in FR-014 can never silently drop a precise factual match in favor of weaker semantic similarity.

## 7. Optional Scoped Cross-Chat Behavior

Cross-chat retrieval remains in scope for this feature but is delivered as a later, self-contained phase (Phase 7, Section 14), after same-chat routing (Sections 3–4), image continuity (Section 5), token budgeting (Section 8), and same-chat semantic retrieval (Section 6) are stable and validated. Nothing in this section may be a prerequisite for those earlier phases.

- **FR-020**: Cross-chat context sharing MUST be off by default and MUST require one explicit, global opt-in setting. No per-message or per-conversation picker is introduced; the alternate-conversation-selection UX removed in Spec 006 Phase 13 is not reintroduced.
- **FR-021**: A conversation MUST be individually markable as excluded from cross-chat retrieval. An excluded conversation MUST NOT contribute content to other conversations' retrieval and MUST NOT itself receive cross-chat content, even while the global setting is enabled.
- **FR-022**: When enabled, cross-chat retrieval scope MUST include only this device's local, non-excluded conversations and MUST apply the same relevance threshold, deduplication, fusion, and untrusted-source attribution as same-chat retrieval.
- **FR-023**: When disabled (the default, or after the user turns it off) or for an excluded conversation, the router MUST NOT include any cross-chat items and MUST NOT run any cross-chat retrieval query against or on behalf of that conversation — zero other-conversation queries occur while disabled, not merely zero results; previously computed cross-chat-eligible embeddings/derived data MAY remain stored so re-enabling does not require rebuilding them.
- **FR-024**: Toggling the global cross-chat setting or a conversation's exclusion flag MUST take effect starting with the very next request, without an app restart and without losing any conversation state.
- **FR-025**: A conversation MUST never receive cross-chat content while the global setting is off or while that conversation is excluded, independently verifiable via zero other-conversation items in that turn's diagnostics.

## 8. Token-Budget Requirements

- **FR-026**: Context-selection budgeting MUST be measured in model tokens or a token-equivalent estimate, replacing the router's current raw-character measurement (`CharacterContextBudgetPolicy`) as the basis for source-selection and eviction decisions. The measurement mechanism is defined by FR-026b.
- **FR-026a**: The token budget MUST reserve distinct capacity for: (1) system instructions, (2) the current request/input, (3) image input (when an image is active or referenced for this request), (4) the selected-context pool (recent turns, facts, summary, and retrieval combined), and (5) generated output. The selected-context pool (4) MUST NOT be sized in a way that can consume capacity reserved for (1), (2), (3), or (5).
- **FR-026b**: The router SHOULD use real runtime-backed token counting (the Qwen/llama.rn native tokenizer, confirmed available via the linked `llama.rn` version's `tokenize()` call) when it can be obtained safely — meaning without a dedicated resource acquisition solely for counting and without adding native round-trips inside the per-candidate selection loop. Where exact counting is not safely available for a given measurement (e.g., the iterative, many-candidate ranking pass), the router MUST fall back to a conservative, deterministic, Qwen-calibrated character-to-token estimator with explicit safety headroom. This feature MUST NOT add a new native dependency solely for token counting.
- **FR-027**: The router's token-budget accounting and the existing downstream hard trim against the real Qwen context window MUST be reconciled into one consistent measurement, so the router never selects a source set that the downstream trim would still need to silently cut.
- **FR-028**: The current request text and any explicitly referenced or active image evidence MUST be protected within the token budget and MUST NOT be evicted to make room for any retrieved, summarized, or cross-chat source.
- **FR-029**: The existing per-response-mode budget tiers (Low/Medium/High) MUST continue to bound router output, re-expressed in token terms rather than characters; cross-chat retrieval MUST share the same mode-scoped retrieval limit rather than adding a separate, unbounded allowance.
- **FR-030 (independent-turn clause superseded by FR-086)**: When assembled context exceeds budget, evict optional sources in this order: cross-chat retrieved items, same-chat retrieved items, durable facts, older-range summaries, then optional recent turns. The current request, attached/explicitly referenced images, direct references, and other `TurnPlan.requiredContextSources` are never evicted. The former “pure independent means current request only” absolute is superseded; exact/direct recovery candidates remain independently eligible.

## 9. Answer-Quality Requirements

- **FR-031**: The existing repetition and truncation detection (`AnswerPostProcessor`'s looping/truncated verdicts) MUST be preserved as a functioning baseline and MAY be improved (e.g., earlier detection, adjusted thresholds) — it is not required to remain byte-for-byte unchanged.
- **FR-032**: Output-length targeting MUST additionally consider the request's classification (Section 4), not only the response mode, so a request classified as an independent text question or text follow-up with an objectively short expected answer is not encouraged to reach the mode's full soft target merely because a longer-form mode is selected. A request that genuinely needs a longer answer (e.g., a long-context retrieval request, or any request in High mode asking for detail) MUST NOT be shortened by this mechanism — length follows task need, in both directions.
- **FR-033**: Repetition control SHOULD detect an emerging loop during generation and stop generation earlier using whatever repetition-control and stopping capability the currently linked Qwen/llama.rn runtime actually exposes, rather than relying solely on post-hoc cleanup after the full hard generation limit is reached. Interruption from an earlier stop MUST preserve the partial text already generated, consistent with Spec 006's existing checkpoint/recovery guarantee (FR-A02) — this feature does not weaken that guarantee.
- **FR-034**: Concise-by-default behavior MUST be reinforced by the request's classification: independent text questions and short text follow-ups favor the shortest complete answer, consistent with and reinforcing the existing mode instructions (`getResponseModeInstruction`).
- **FR-035**: Truncation/looping post-processing and the length/repetition controls above MUST run identically on answers informed by any source scope, including cross-chat context once Phase 7 ships — no answer path bypasses these controls.
- **FR-036**: A deterministic grounding/hallucination assessment (comparing an answer's specific claims — extracted text, counts, prices, named colors/objects — to included evidence/retrieved text) MAY be added in a later, optional, diagnostics-only phase (Phase 8, Section 14). If added, it MUST NOT require a second model-generation pass, and MUST NOT automatically rewrite, suppress, or otherwise change the visible answer — it may only add a diagnostics field. Implementation of FR-031 through FR-035, and of Sections 4–8, MUST NOT depend on or be blocked by this assessment existing, and it is explicitly excluded from this feature's core acceptance criteria and core required automated tests (Section 12).
- **FR-036a**: Any change to sampling, stopping, or repetition-control parameters under this section MUST be verified against the API actually exposed by the currently linked `llama.rn`/Qwen runtime (not assumed from memory, documentation for a different version, or a different runtime) and validated through manual testing on a physical device before being pinned as a constant, consistent with Constitution IX ("Verify Before Assuming").

## 10. Diagnostics Requirements

Routing diagnostics are the first phase of this feature (Phase 1, Section 14): they MUST be added before router behavior changes, so the team can observe what the router would decide alongside what today's fixed-assembly pipeline actually does, before switching behavior.

- **FR-037 (extended)**: Turn diagnostics MUST record authority mode, exact plan
  owner/ID/version, legacy classification when applicable, eligible/considered/
  selected sources, retrieval mode/reason, vision strategy/evidence status,
  resolved or `unresolved-reference` image candidates, cross-chat scope, and
  constrained-planner gate/invocation/latency/result/fallback. No ambiguity
  resolution may identify an image unless unique resolution succeeded.
- **FR-038**: Diagnostics export MUST continue to sanitize local paths, exclude images by default, and disclose included conversation content exactly as today, extended to cover any cross-chat conversation identifiers introduced once Section 7 ships.
- **FR-039**: Diagnostics MUST remain exportable from persistence repositories rather than bounded UI caches, so router decisions for evicted or older turns stay inspectable after the fact, consistent with existing beta diagnostics behavior.
- **FR-040**: If and when the optional grounding/hallucination assessment (FR-036) is added, its verdict MUST appear in per-turn diagnostics alongside the existing truncated/looping verdict; until then, diagnostics MAY omit this field entirely without being considered incomplete.

## 11. Manual Validation Criteria

Manual conversation scenarios in the app, cross-checked against exported diagnostics, are the primary way this feature is validated. Each criterion below is directly observable through normal app use and/or the diagnostics export, and each phase (Section 14) is validated manually before the next phase begins.

- **MV-001**: Independent text question inside a chat with unrelated history — asking a self-contained factual question in a chat with unrelated prior turns, facts, a summary, and an unrelated image produces, per diagnostics, zero prior turns, zero summary content, zero facts, zero retrieved items, and zero image evidence even considered.
- **MV-002**: Normal text follow-up — asking a follow-up with a genuine reference pulls in only the recent turns needed to resolve it, per diagnostics, without unrelated retrieval or image evidence.
- **MV-003**: Long-chat earlier-fact recovery — in a conversation long enough to trigger summarization, asking about an earlier topic surfaces the relevant durable fact/summary/retrieved item (visible in diagnostics), while asking an independent question in the same conversation does not pull in unrelated older material.
- **MV-004**: New image question — attaching a new image and asking about it produces visual evidence in the answer and in diagnostics, and that image becomes the active image for later follow-ups.
- **MV-005**: Same-image general follow-up — a non-pixel-dependent follow-up about the active image reuses stored evidence (no reprocessing); a follow-up with no visual language does not re-attach evidence at all.
- **MV-006**: Same-image OCR/count/price follow-up — a pixel-dependent follow-up about the active image causes the original image to be re-run through the Qwen vision path (visible as a fresh evidence record tied to a new inference in diagnostics), not answered from the old evidence text, when the original is still available.
- **MV-007**: Older-image reference — with two or more images in one chat, an unambiguous reference to an earlier one resolves to that specific image in the answer and diagnostics, never a different one.
- **MV-008**: Ambiguous image reference — with two or more plausible images and
  no uniquely supported match, diagnostics record `unresolved-reference`/
  clarification, select no image/evidence, and make no target-specific visual
  claim until resolution succeeds.
- **MV-009**: Missing original image — a pixel-dependent question about an image whose original file is gone reports the original as unavailable; a non-pixel-dependent question about the same missing-original image may still be answered from sufficient stored evidence.
- **MV-010**: Unrelated question after an image — asking an unrelated, independent question immediately after an image turn produces no image evidence in that answer or its diagnostics.
- **MV-011**: Repetition and overly long output — a loop-prone prompt/fixture stops noticeably earlier than the hard limit and is still cleaned up; an independent short-answer question does not receive a padded, mode-length answer; a genuinely detailed question is not artificially shortened.
- **MV-012**: Typed versus voice-transcribed equivalence — a transcribed-and-submitted voice message produces the same routing behavior and diagnostics as typed text with identical content.
- **MV-013**: Semantic retrieval enabled and unavailable — with an approved embedding runtime active, a question with both an exact lexical match and a related-but-non-overlapping semantic passage shows a fused result that keeps the exact match; with embeddings stale, incompatible, still building, or failing, the same conversation falls back to lexical-only without failing the request.
- **MV-014**: Cross-chat off, on, excluded conversation, and disabled again — with the setting off (default), no chat ever includes another conversation's content; enabling it surfaces relevant, attributed, untrusted content from another local chat; excluding a specific conversation stops it from contributing to or receiving cross-chat content even while the global setting stays on; disabling the global setting again stops all cross-chat inclusion on the very next message.
- **MV-015**: Cancellation, restart, and conversation reload — cancelling an in-flight generation preserves partial text exactly as Spec 006 already guarantees; restarting the app preserves the cross-chat setting and any per-conversation exclusion flags; reloading a conversation and repeating an identical request reproduces identical classification and context selection (FR-006).
- **MV-016**: Token-budget consistency — the router's token-budget accounting never selects a source set that the final model-context trim then has to silently cut further, confirmed via diagnostics showing consistent used/maximum units against the actual Qwen context window and the reserved-capacity buckets (FR-026a).
- **MV-017**: Final airplane-mode operation — with the device in airplane mode, every code path touched by this feature (classification, image re-inference, token budgeting, retrieval fusion, cross-chat scope resolution, generation controls) completes with zero network calls, matching Spec 006's existing offline guarantee.
- **MV-018**: Broad regression — existing text chat, image chat, voice capture/transcription, History pagination and search, model download/verification, and general offline/zero-network operation all continue to work exactly as before this feature (regression pass against Spec 006 acceptance scenarios).

## 12. Minimal Automated-Test Requirements

Automated tests are required only for small, deterministic, high-risk logic. Coverage is focused on exactly these five areas — no others:

- **Request routing**: legacy classification combinations, the bounded independent-routing recovery, authority-mode ownership, and deterministic repeatability of tiers 1/2 candidate construction and tier-4 validation.
- **Image-reference and missing-image selection**: use-original-via-reinference vs. use-evidence vs. original-unavailable vs. evidence-unavailable, across available/missing asset and pixel-dependent/not-pixel-dependent combinations, `unresolved-reference`/clarification behavior (FR-012a), and that "use original" actually triggers a fresh vision-inference call rather than a label-only decision.
- **Token-budget protection and eviction**: current request and active/referenced image evidence are never evicted; the reserved-capacity buckets (FR-026a) are respected; eviction order (cross-chat → same-chat retrieved → durable facts → summary entries → recent-turn floor where one exists) is enforced; the token-based measurement stays consistent with the downstream hard trim.
- **Lexical/semantic fusion and fallback**: fallback to lexical-only when embeddings are missing/stale/incompatible/still building/failing; correct fusion and deduplication when both lexical and semantic candidates are available, including that fusion never drops an exact match on a name, number, price, date, or identifier (FR-019a).
- **Cross-chat isolation**: off-by-default with zero leakage and zero cross-chat queries while disabled, per-conversation exclusion enforced in both directions, and immediate effect when the global setting or an exclusion flag is toggled.

**Explicitly does not require new automated tests for:**

- Exact wording, phrasing, or tone of any generated answer.
- OCR accuracy, counting accuracy, or any other measure of visual correctness.
- Overall generation quality or response helpfulness.
- UI snapshot or pixel-level rendering tests for the cross-chat setting or exclusion control.
- Voice transcription accuracy (out of scope; already covered by Spec 006's voice validation metrics).
- The optional grounding/hallucination heuristic (Phase 8) — it is not part of this feature's core delivery; if and when it is separately approved and implemented, its own focused tests are scoped at that time.
- Precise timing of "earlier loop stopping" (FR-033), or the specific sampling/stopping parameters chosen under FR-036a.

All of the above are validated through manual conversation scenarios and exported diagnostics (Section 11), not new unit or integration assertions.

## 13. Open Questions

- Exact token-budget numbers per response mode (Low/Medium/High) and per reserved bucket (FR-026a), now that measurement moves from characters to tokens, need recalibration against the existing evaluation harness (`src/evaluation`) rather than being fixed in this spec.
- The former open question about a definitive semantic regex vocabulary is
  closed by FR-043–FR-047: patterns may construct deterministic candidates but
  are not the primary semantic authority.
- Whether task-sensitive output limits (FR-032) should be a small fixed set of tiers or a continuous function of classification plus mode is deferred to planning.
- Whether the optional grounding/hallucination assessment (Phase 8), if ever built, should surface any visible signal to the user, or remain diagnostics-only indefinitely, is still open — and is explicitly not a blocking question for this feature's core delivery.
- EmbeddingGemma is the first provider to evaluate, but its artifact/runtime,
  dimensions, latency, memory, and device approval remain pending. This gate
  controls semantic activation only, not planner authority.

## 14. Implementation Phasing (Non-Binding Sequencing)

This ordering guides `plan.md`, `tasks.md`, `contracts/`, and `quickstart.md` consistently, and is not itself a task breakdown:

1. **Diagnostics-only routing visibility** — instrument classification and source-consideration/selection visibility (Section 10) before changing any routing behavior, so today's fixed-assembly behavior can be observed and compared against.
2. **Image identity, reference resolution, and original-pixel follow-ups** — wire `ImageEvidencePolicy`, ensure correct (including ambiguous-reference-safe) image resolution across current/older images, and implement true original-image re-inference through the Qwen vision path for pixel-dependent requests (Section 5).
3. **Minimal-context request routing** — apply classification and source-selection rules so independent questions and follow-ups receive only what they need (Sections 3–4).
4. **Model-aware token budgeting** — move from character-based to token-aware budget measurement with reserved capacity buckets, reconciled with the existing hard context-window trim (Section 8).
5. **Generation length, repetition, and stopping improvements** — task-sensitive output limits, runtime-verified earlier loop stopping, concise defaults, and improved (not merely preserved) post-processing (Section 9, excluding grounding).
6. **Same-chat semantic embedding activation and hybrid fusion** — query-time embedding wiring and deterministic fusion/reranking of lexical and semantic candidates with the exact-match guarantee (FR-019a), subject to the existing embedding-artifact approval gate (Section 6).
7. **Optional scoped cross-chat retrieval** — global opt-in, per-conversation exclusion, and expanded retrieval scope (Section 7), built only once Phases 1–6 are stable.
8. **Optional grounding diagnostics** — deterministic unsupported/hallucinated-claim assessment surfaced in diagnostics only (Section 9's deferred item), built only once Phases 1–7 are stable; never blocks or is required by any earlier phase.
9. **Final manual device validation** — the full manual validation matrix (Section 11) exercised end to end on a physical device, including final airplane-mode operation (MV-017) and the broad Spec 006 regression pass (MV-018).

## Superseded Requirements

This section states exactly where this feature overrides prior behavior established in Spec 006. Everything not listed here — the SQL store, immutable messages, retries, image assets, summaries/facts, response modes, single-flight inference, voice, and privacy model — is preserved unchanged (see Preserved Foundations).

- **Character-based context budgeting** (Spec 006 `CharacterContextBudgetPolicy`, `contextBudgetUnits` in raw characters) is superseded by token-aware budgeting with reserved capacity buckets (Section 8). The `ContextBudgetPolicy` interface itself is reused, not replaced.
- **The assumption that a visual follow-up can always be answered from stored evidence text** is superseded for pixel-dependent requests (Section 5): those now require the original image to be re-run through the Qwen vision path, not answered from evidence alone. Non-pixel-dependent follow-ups continue to reuse evidence exactly as Spec 006 intended.
- **An unconditional recent-turn floor applied to every request** remains superseded. Required recent context is now a plan field; the independent label alone neither forces recent context nor prevents FR-086 exact/direct recovery.
- **Evidence-only handling for pixel-dependent visual questions** (where existing evidence, once present, was treated as sufficient regardless of question type) is superseded by the pixel-dependent re-inference requirement (Section 5) — evidence sufficiency no longer overrides a pixel-dependent classification.
- **The removed selected-past-chat behavior** (Spec 006 Phase 13's full removal of the per-message alternate-conversation picker) remains removed and is not reintroduced. This feature's cross-chat mechanism (Section 7) is a distinct, later-phase, global-opt-in-with-exclusion design — it supersedes only the *absence* of any cross-chat path, not the decision to remove the old picker UX, which stands.
- **Fixed, non-tunable generation/post-processing behavior** (Spec 006's requirement that `AnswerPostProcessor` and generation parameters stay exactly as shipped) is superseded: targeted, runtime-verified improvements are now permitted (Section 9) — but only as improvements to the same safety net, not a redesign of it.

## Preserved Foundations

This feature is an incremental extension of Spec 006, not a rewrite. The following are explicitly unchanged and MUST continue to function exactly as today unless a line in Superseded Requirements says otherwise:

- SQLite as the canonical conversation store (Constitution VIII).
- Immutable user messages and terminal assistant attempts (Spec 006 US2).
- The existing retry-attempt model (new attempts linked to the same user message; one active attempt).
- Durable image assets and their message-links, and the existing visual-evidence lifecycle (Spec 006 US5), beyond the pixel-dependent re-inference addition in Section 5.
- Summaries and durable facts, including their fixed compaction triggers and isolated-Qwen-request generation.
- Per-conversation Low/Medium/High response modes, including their existing model and generation-limit contract (Section 9 only adds a classification-aware layer on top).
- App-wide single-flight inference (`InferenceQueue`/`DeviceResourcePolicy`); this feature adds no second queue and no concurrent inference path.
- Qwen3-VL running through `llama.rn` as the unchanged current main inference provider; application architecture depends on the model-independent provider boundary in FR-069–FR-072.
- Offline voice transcription (whisper.rn, record-then-transcribe, gated behind `VOICE_INPUT_ENABLED`).
- Local-only, zero-network privacy for every stage of capture, preprocessing, inference, retrieval, and persistence (Constitution I).
- Existing History, diagnostics export, model download/verification, generation cancellation, and interrupted-answer recovery flows.
- The existing UI theme and design system (`design/`); this feature's only new UI is the cross-chat toggle and exclusion control, built from existing tokens/components.

## Key Entities

- **Context Router / Routing Decision**: the per-request decision of which of the eight sources to include, extending `ContextOrchestrator`.
- **Request Classification**: one or more of independent text question / text follow-up / new image question / same-image follow-up / older-image reference / pixel-dependent visual request / long-context retrieval request / cross-chat-eligible request, computed from deterministic signals; combinable, not mutually exclusive.
- **Image-Reference Resolution**: either a uniquely supported image identity or an explicit `unresolved-reference`/clarification result. The active image is not an ambiguity fallback (FR-012a).
- **Retrieval Candidate / Retrieved Item**: existing entities (`RetrievalCandidate`, `RetrievedItem`), now fused across lexical and semantic sources with an exact-match guarantee, and, once Phase 7 ships, scoped across non-excluded chats.
- **Image-Evidence Decision**: use-original-via-reinference / use-evidence / original-unavailable / evidence-unavailable, plus a pixel-dependent flag, produced by the extended `ImageEvidencePolicy`; "use-original" always means a fresh Qwen vision-inference call on the original file.
- **Token Budget**: the router's context-selection accounting, measured in model tokens (or a calibrated token-equivalent estimate) with five reserved capacity buckets (system instructions, current input, image input, selected context, generated output), reconciled with the existing hard Qwen context-window trim.
- **Cross-Chat Memory Setting**: one global, persisted, on/off setting controlling cross-conversation retrieval scope.
- **Cross-Chat Exclusion Flag**: a per-conversation, persisted flag that removes a conversation from cross-chat retrieval in both directions regardless of the global setting.
- **Grounding/Hallucination Assessment** (optional, Phase 8, diagnostics-only): a per-turn deterministic verdict on whether the answer's specific claims are supported by included evidence/retrieved text.
- **Router Diagnostics**: the extension of `ContextSelectionDiagnostics` capturing classification, source selection, retrieval mode, image decision (including ambiguity resolution), and (once shipped) cross-chat usage and grounding verdict.

## Assumptions

- The router is an extension of `ContextOrchestrator`, not a replacement; existing budget-policy, evidence-repository, retriever, and fact/summary source interfaces are reused (`HybridContextSources`).
- Token-budget measurement prefers a native tokenizer call through the existing llama.rn/Qwen runtime binding where it can be used safely (confirmed available as `tokenize()`; see `research.md`), and otherwise falls back to a calibrated token-estimate heuristic with safety headroom — the exact mix is a planning-time decision, verified against current llama.rn capabilities before implementation (Constitution IX).
- Deterministic lexical/pattern signals remain candidate inputs and syntax parsers, not the primary semantic authority. Ambiguous dependency is handled by ledger/retrieval evidence and, only when its deterministic gate permits, the constrained planning tier.
- Fusion of lexical and semantic retrieval combines both signal types into one ranked list, with an explicit exact-match guarantee for names/numbers/prices/dates/identifiers, rather than letting semantic scoring override or hide a precise match.
- Semantic retrieval activation stays behind the pre-existing embedding-artifact approval gate; this feature closes the "component exists but is never wired at query time" gap and adds fusion, but does not itself approve or select the embedding model, and no part of this feature assumes that approval has already happened.
- Cross-chat memory is a single global opt-in setting plus a per-conversation exclusion flag (not a per-message picker), matching the simplest, least-leaky design and deliberately avoiding the picker UX removed in Spec 006 Phase 13; it is explicitly sequenced after routing, image continuity, token budgeting, and same-chat semantic retrieval are stable (Phase 7).
- The grounding/hallucination assessment is explicitly deferred, optional, and diagnostics-only (Phase 8); nothing in Phases 1–7 depends on it, it never rewrites or suppresses an answer, and it remains a deterministic heuristic over already-available evidence/retrieved text rather than an additional model-inference pass.
- Planning uses deterministic application/ledger/exact signals first and may use a constrained structured call through the existing main provider only for the bounded ambiguous tail defined in FR-091–FR-093; ordinary turns do not incur this call.
- Voice-transcribed text is treated identically to typed text once it reaches the router; transcription confidence/quality is out of scope.
- All routing, retrieval, and (if built) grounding logic runs entirely on-device with zero network calls, consistent with the project's non-negotiable privacy architecture.
- This feature builds on and does not regress any Spec 006 functional requirement or success criterion; where this spec is silent, Spec 006's behavior stands (see Preserved Foundations).

## 15. Authoritative Architecture Revision (2026-07-28)

This section and the revised contracts are authoritative wherever they conflict
with Sections 3–14. Earlier text remains to preserve the history of the
implemented first architecture and its completed task states; it is not an
instruction to continue adding regex patches.

### 15.1 Unified planning authority

- **FR-041**: Every submitted, continued, retried, or regenerated turn MUST
  produce exactly one validated structured planning result, named `TurnPlan` in
  this specification. Wave A MVP fields are authority mode, turn intent,
  modality, conversation dependency, resolved/unresolved references, required
  context sources, memory read/write requirements, vision strategy, generation
  task kind, confidence, and safe fallback. Active topic/entity detail,
  fine-grained retrieval scoring hints, and output-format enrichment are optional
  later fields and MUST NOT create another authority.
- **FR-042**: Request classification, context orchestration, generation
  planning, vision execution, `InferenceQueue`, refusal recovery, and grounding
  assessment MUST execute the validated `TurnPlan` and MUST NOT independently
  infer or override its semantic decisions. Capability and asset validation are
  permitted; silent semantic reclassification is not.
- **FR-043**: Planning MUST follow four tiers: deterministic application state;
  semantic signals; constrained structured-model fallback only for remaining
  ambiguity; and deterministic validation/safe fallback.
- **FR-044**: Deterministic state includes current attachments, available prior
  assets, active conversation, continue/retry/regenerate action, settings,
  feature gates, and provider/artifact readiness.
- **FR-045**: Semantic signals include active-topic/entity similarity, eligible
  exact and lexical evidence, ledger state, and recent dependency state.
  Embedding similarity is additive when an approved provider/index is ready; it
  is never required for planner authority or safe operation. No one signal is
  authoritative by itself.
- **FR-045a**: In the supported lexical-only authoritative mode, active-topic and
  active-entity matching MAY use conversation-state ledger identities, canonical
  labels, known aliases, exact lexical matches, code identifiers, direct
  references, and active comparison state. This mode MUST NOT introduce new
  semantic regex routing; embeddings add semantic similarity only when available.
- **FR-046**: Constrained model fallback returns only unresolved planning fields
  under FR-091–FR-093; it never recreates the complete plan. The current Qwen
  provider MAY initially supply this capability, but ordinary independent
  questions, clear image turns, explicit memory reads/writes, retry, regenerate,
  and continuation MUST NOT invoke it.
- **FR-047**: Regex MAY parse deterministic syntax such as identifiers,
  explicit ordinals, file paths, dates, code identifiers, and structured output.
  Regex MUST NOT remain the primary authority for semantic intent,
  conversational dependency, memory recall, active-topic selection, or
  image-reference understanding.
- **FR-048**: Low confidence or failure in one planning field MUST NOT remove
  independently established requirements. An attached image, explicit
  reference, explicit memory write, or required current request survives an
  uncertain intent/dependency decision.
- **FR-049**: A plan requiring image pixels MUST NOT silently fall back to
  text-only generation. A plan with multiple plausible image targets MUST keep
  the reference unresolved, select no image, and request clarification. No
  pixels or stored evidence may be represented as belonging to the requested
  image until resolution succeeds. It MUST NOT guess or silently default to the
  active image.

The full shape and invariants are defined in
[`contracts/unified-turn-planning.md`](./contracts/unified-turn-planning.md).

### 15.2 Conversation-state ledger and memory

- **FR-050**: Each conversation MUST have a lightweight derived
  conversation-state ledger tracking active topics, active entities, active
  comparison targets, active image entities, referenced code/documents,
  unresolved references, recent explicit decisions, and explicit memory writes.
- **FR-051**: The ledger MUST NOT replace canonical SQLite messages. Every
  derived entry retains source-message provenance and `sourceRevision`, defined
  here as a content/status/version hash rather than a general editing API.
  Invalidation/rebuild covers creation, deletion, conversation deletion, retry,
  regeneration, superseded assistant attempts, evidence reinference,
  model/index-version changes, and derived-record rebuilds. General
  source-message editing is out of scope.
- **FR-052**: The memory architecture MUST distinguish immediate working
  memory, the conversation-state ledger, explicit durable memories, episodic
  retrieval units, segment summaries, structured image evidence, and optional
  cross-chat memory.
- **FR-053**: Explicit user memory statements MUST be persisted and available
  to planning and lexical/direct memory lookup immediately after their canonical
  source message is persisted. They MUST NOT wait for compaction, summarization,
  embedding backfill, restart, or a long-conversation threshold.
- **FR-054**: Compaction and segment summarization MUST support ordinary short
  and medium conversations through bounded segment policies; they MUST NOT be
  the activation mechanism for explicit memory.
- **FR-055**: Reliability is ordinal, from highest to lowest: direct user-stated
  fact/explicit decision; confirmed structured evidence from source pixels;
  deterministically extracted exact content with provenance; confirmed durable
  derived fact; completed grounded assistant answer; ordinary assistant answer;
  uncertain assistant answer; refusal-like/failed/interrupted/cancelled/
  superseded attempt. Higher reliability may break relevance ties; low
  reliability cannot override an exact higher-reliability fact. Semantic
  similarity alone cannot promote an assistant claim into a durable fact.
- **FR-056**: Failed, cancelled, interrupted, refusal-like, superseded, or
  unsupported assistant attempts MUST NOT rank as trusted factual evidence or
  become authoritative image evidence.

The ledger and memory-layer contract is
[`contracts/conversation-state-ledger.md`](./contracts/conversation-state-ledger.md).

### 15.3 Typed retrieval units and hybrid ranking

- **FR-057**: Retrievable content MUST be represented as typed units, including
  user messages, completed assistant answers, code blocks, explicit memories,
  durable facts, decisions, summary segments, and structured image evidence.
- **FR-058**: Every retrieval unit MUST retain a stable ID, conversation scope,
  source-message IDs, unit type, searchable text, reliability, source revision,
  and creation/update timestamps.
- **FR-059**: Hybrid ranking MUST combine lexical, semantic, entity,
  provenance, reliability, scope, and recency signals, then deduplicate
  overlapping sources before context selection.
- **FR-060**: Lexical retrieval MUST remain available for exact prices, dates,
  names, unit numbers, IDs, code identifiers, and quoted text. Semantic scoring
  MUST NOT replace or hide exact-match retrieval.
- **FR-061**: Semantic retrieval eligibility MUST NOT be controlled by a binary
  “independent question means never retrieve” gate. The planner may reject
  irrelevant candidates, but one dependency classification cannot disable
  recent context, retrieval, facts, summaries, image evidence, and explicit
  memory together.

### 15.4 Model-independent embedding architecture

- **FR-062**: Application code MUST depend on an `EmbeddingProvider` contract
  that distinguishes query embeddings, document embeddings, model descriptor,
  artifact identity, vector dimensions, prompt-policy version, source revision,
  normalization, runtime readiness, cancellation, and model/index migration.
- **FR-063**: EmbeddingGemma is the first provider to evaluate for same-chat and
  optional cross-chat semantic retrieval, code retrieval, explicit-memory
  retrieval, textual image-evidence retrieval, active-topic/entity similarity,
  and planner intent/reference-resolution signals.
- **FR-064**: EmbeddingGemma MUST NOT generate final answers, inspect image
  pixels, decide the complete `TurnPlan`, replace lexical retrieval, or determine
  source reliability.
- **FR-065**: Embedding activation MUST be feature-gated and artifact-approved.
  Indexes MUST be versioned; background indexing MUST be restart-safe and pause
  for visible inference; lexical fallback MUST remain available while indexes
  are incomplete, stale, incompatible, cancelled, or failed.
- **FR-066**: Vector staleness and re-indexing MUST account for embedding model,
  artifact, dimensions, prompt policy, normalization, and source revision.
  Provider migration builds a new index without modifying canonical messages.
- **FR-067**: Conversation deletion MUST cascade to its derived retrieval units
  and vectors. Changing embedding providers MUST NOT lose or migrate canonical
  conversation data.
- **FR-068**: The first production dimension remains a benchmark decision.
  Evaluation MUST compare at least 256 and 512 dimensions for retrieval quality,
  latency, memory, storage, backfill time, and battery impact.

See [`contracts/embedding-provider.md`](./contracts/embedding-provider.md).

### 15.5 Model-independent main inference architecture

- **FR-069**: The main inference runtime MUST be behind a provider boundary with
  a capability descriptor covering text generation, image input, structured
  extraction, context limit, native tokenizer, generation limits, projector
  requirements, runtime compatibility, cancellation, and supported prompt
  format.
- **FR-070**: The current production Qwen3-VL model MUST NOT change in this
  phase. The provider boundary MUST permit a later Qwen3.5 or compatible
  multimodal provider without redesigning turn planning, ledger state, memory
  storage, retrieval units, embedding indexes, context ranking, image-evidence
  persistence, or diagnostics.
- **FR-071**: Switching the main model MUST NOT require re-embedding stored
  memories unless the embedding provider/index descriptor itself changes.
- **FR-072**: Final prompt verification MUST use the selected main provider's
  native tokenizer and capability descriptor, not an application-wide
  Qwen-specific constant.

See
[`contracts/main-inference-provider.md`](./contracts/main-inference-provider.md).

### 15.6 Authoritative vision execution

- **FR-073**: `TurnPlan` MUST contain one authoritative vision execution plan
  with strategies equivalent to: no vision; reuse stored evidence; inspect one
  original image; inspect and persist structured evidence; or compare multiple
  evidence sets.
- **FR-074**: Every image MUST be a first-class image entity with stable
  identity, source-message provenance, asset URI/availability state, content
  revision, and evidence links.
- **FR-075**: Wave B structured image evidence MVP MUST contain image identity
  and source message, a short summary, visible objects, extracted text, numeric
  values (including prices, dates, counts, and serial-like values), optional
  text/value-to-object associations, uncertainty, and status
  (`complete | partial | failed | stale`). Spatial relationships and a full
  scene graph are optional later extensions, not MVP acceptance requirements.
- **FR-076**: A normal image turn MUST attempt and persist the Wave B evidence
  record even when its visible answer used a direct-image path. Partial/failed
  extraction is persisted truthfully, and canonical pixel availability remains
  the follow-up path; assistant prose is never the only reusable visual source.
- **FR-077**: Canonical image pixels, derived structured evidence, and prior
  assistant prose are distinct sources. Previous refusals, image-unavailable
  claims, or unsupported visual prose MUST NOT be treated as authoritative
  evidence during reinspection.
- **FR-078**: Multi-image comparisons MUST preserve separate image identities,
  evidence sets, provenance, and uncertainties through context assembly and
  generation.
- **FR-078a**: Malformed or incomplete extraction becomes `partial` or `failed`,
  never silently `complete`. Original-pixel reinspection remains possible. A
  text-only formatting retry cannot claim new visual facts without pixels.
  Diagnostics record complete/partial/failed/stale status and whether evidence
  was reused or freshly inspected.

The extended contract is
[`contracts/image-continuity.md`](./contracts/image-continuity.md).

### 15.7 Context assembly

- **FR-079**: Context assembly MUST, in order: preserve the current request;
  preserve required images and direct references; retrieve only eligible
  sources; rank by hybrid relevance and reliability; deduplicate overlapping
  sources; allocate token budget; preserve provenance; reserve generation
  headroom; and verify the final prompt with the selected provider's native
  tokenizer.
- **FR-080**: The complete conversation remains in canonical SQLite storage.
  Excluding irrelevant material from one prompt MUST NOT delete or rewrite it.
- **FR-081**: Refusal recovery and reinspection MUST assemble context from
  canonical image entities and eligible evidence, explicitly excluding the prior
  refusal as factual authority.

### 15.8 Diagnostics and safe rollout

- **FR-082**: Shadow diagnostics MUST record the legacy classification/selection,
  proposed validated `TurnPlan`, field confidence, signal provenance,
  validation changes, execution results, and material differences without
  changing the visible answer.
- **FR-083**: The legacy implementation MUST remain available during shadow
  comparison until golden scenarios, automated contract tests, and physical
  device diagnostics support authority transfer. The migration MUST NOT replace
  every component in one implementation task.
- **FR-084**: After the new planner becomes authoritative, obsolete semantic
  regex routing and duplicate semantic decisions MUST be removed. Deterministic
  syntax regex and validation remain.
- **FR-085**: All planning, embeddings, retrieval, memory, vision, generation,
  and persistence remain on-device and zero-network. Model and embedding work
  obey the single-flight resource policy and degrade without crashes.

### 15.9 Architectural-review corrections

- **FR-086 — Early independent-routing recovery**: Before unified-planner
  authority, a narrow recovery step MUST run before the completed legacy
  independent-question hard skip. It protects exact explicit-memory matches,
  exact same-chat lexical matches, directly referenced entities, attached
  images, explicit image references, explicit user facts, and active comparison
  targets. It does not broadly infer intent, add semantic regexes, or select
  merely related context. It is a temporary blast-radius reduction removed when
  the new planner becomes authoritative.
- **FR-087 — Authority modes**:
  - In `shadow`, legacy routing executes the complete turn. The new planner is
    diagnostics-only and changes no visible behavior, context/image selection,
    memory write, or inference execution. It MUST NOT insert a live Tier-3 call
    into the shadow turn; it records `wouldInvoke` for separate validation.
  - In `controlled`, only explicitly named scenario classes or feature-gated
    turn types use the validated new plan for the entire turn. For a controlled
    image-related class, that complete turn includes reference resolution,
    image selection, context-source selection, context assembly, vision
    strategy, generation-task projection, and inference execution. Legacy
    semantic routing is bypassed for the entire turn and remains available only
    as a full-turn rollback. Wave B tests MUST prove a controlled image turn
    makes zero legacy semantic decisions.
  - In `authoritative`, the new planner controls every supported turn and legacy
    semantic routing is not consulted. Legacy code may remain temporarily behind
    a full-turn rollback gate until physical validation passes.
- **FR-088 — One turn, one authority**: No single turn may be executed by two
  semantic authorities. A turn MUST NOT combine new-planner vision with legacy
  context, generation, memory, retrieval, refusal-recovery, queue, or grounding
  decisions. Every diagnostic record includes `authorityMode` and exact
  `planOwner`.
- **FR-089 — Planner authority without embeddings**: Authority transfer MUST
  be possible with deterministic application state, ledger state, recent
  dependency context, exact/lexical retrieval, explicit memories, deterministic
  reference resolution, and validated constrained fallback when permitted.
  EmbeddingGemma approval, indexing, or semantic activation is not an entry
  condition. Lexical-only is a fully supported runtime mode; cross-chat semantic
  activation remains separately gated.
- **FR-090 — Embedding migration operation**: Migration builds a new versioned
  index while lexical fallback remains available, validates the new index,
  atomically activates it, and retires the previous index later. Compatibility
  keys remain provider/model ID, artifact hash, dimensions, prompt-policy
  version, normalization, and source revision.
- **FR-091 — Constrained-planner input and output**: Tier 3 receives a
  deterministically ordered set of candidate reference IDs and only the
  unresolved field requests. Its validated output contains: the candidate IDs
  received; selected IDs or unresolved status; intent clarification when
  requested; memory-read versus memory-write interpretation; requested context
  scope; confidence in `[0,1]`; bounded rationale codes; and
  `clarificationRequired`. It cannot add an ID it was not given or replace
  already resolved fields. Initial rationale codes are
  `reference-language-match`, `candidate-description-match`,
  `recent-dependency-match`, `ledger-entity-match`, `memory-command-semantics`,
  `memory-question-semantics`, `context-scope-language`, and
  `insufficient-evidence`.
- **FR-092 — Constrained-planner gate and resource policy**: Tier 3 MAY run only
  when deterministic state, ledger state, exact/lexical evidence, and
  deterministic reference resolution leave at least two materially plausible
  interpretations whose difference would change an image target, memory
  operation, context scope, or answer task. It MUST NOT run for ordinary
  independent questions, clear image turns, explicit memory writes, explicit
  memory recalls, retry, regenerate, or continuation. It runs serially before
  answer generation under the existing single-flight device-resource policy,
  supports cancellation and app suspension, uses at most 96 generated tokens,
  and has an 8-second execution timeout after acquiring its resource lease.
  Queue wait and Tier-3 execution latency are diagnosed separately from normal
  context-assembly latency.
- **FR-093 — Constrained-planner fallback and testing**: Output is accepted only
  after deterministic schema/candidate validation and confidence at or above the
  versioned initial threshold `0.80`. Unavailable, cancelled, suspended,
  timed-out, malformed, or lower-confidence results use a conservative
  deterministic fallback: preserve attachments, direct references, exact
  memory candidates, and current input; keep ambiguous image references
  unresolved and request clarification; never create an uncertain durable
  memory; and use lexical-only context when safe. Golden scenarios MUST resolve
  without Tier 3 and assert it was not invoked. Separate bounded contract tests
  use mocked structured outputs for cancellation, timeout, malformed output,
  candidate injection, and low confidence.
- **FR-094 — Explicit-memory interpretation**: Memory writes are detected from
  explicit user command/action semantics, structured planner output,
  deterministic validation, user-stated factual content, and current memory
  scope settings—not primarily from open-ended regex. “Remember my rent is
  $1,689”, “Save my unit as 3427-014”, and “My move-in date is August 10;
  remember it” are writes. “Do you remember my rent?” and “Remember when we
  discussed graphs?” are reads. “I remember that algorithm” is neither an
  automatic read nor write. An uncertain write MUST NOT silently create durable
  memory; it remains conversation-scoped or requests clarification. A confirmed
  correction supersedes the prior memory while retaining both source
  provenances and making only the newest eligible value active.
- **FR-095 — Ledger ordering and restart**: For each completed turn the system
  MUST (1) persist the completed canonical turn, (2) derive validated execution
  results, (3) update or rebuild the ledger, and (4) publish that ledger before
  planning the next turn. The next turn MUST NOT see state one completed turn
  behind. Persisted ledger state is a versioned cache; missing, incompatible,
  stale, or corrupt state is rebuilt from canonical messages and persisted
  structured records. Corruption cannot alter canonical history. Deletion,
  retry, regeneration, superseded attempts, and evidence reinference invalidate
  affected derived entries before the next plan.
- **FR-096 — Cross-chat exclusions and explicit memories**: A durable memory
  created in a conversation remains immediately available inside that source
  conversation. If that conversation is excluded from cross-chat, neither the
  source message nor its derived memory may contribute to another conversation,
  and the excluded conversation cannot receive cross-chat sources.

## 16. Revised Golden Validation Scenarios

- **GV-001 Text dependency**: Provide recursive and iterative code; ask which is
  better; then ask which of the two should be used in an interview. The ledger
  retains both comparison targets and the planner selects the relevant code and
  prior decision context.
- **GV-002 Explicit memory**: Tell Locra to remember an apartment rent; ask
  unrelated questions; recall the rent without using “remember,” “earlier,” or
  “mentioned.” The value is available immediately and exact lexical retrieval
  remains possible before semantic indexing.
- **GV-003 Image continuity**: Upload a market image; ask for visible products;
  ask for their prices using a pronoun; ask which price belongs to a specific
  product. The same image entity and structured object/value associations remain
  active.
- **GV-004 Image reinspection**: Produce or inject a false image-unavailable
  response; ask Locra to inspect the image again. The original image entity is
  used and the prior refusal is excluded as authoritative evidence.
- **GV-005 Multi-image comparison**: Upload two images and ask for a comparison.
  Both identities and evidence sets remain separate through planning, assembly,
  generation, and diagnostics.
- **GV-006 Retrieval negative**: Ask an unrelated self-contained question. No
  irrelevant conversation or image context is selected, while planning does not
  rely on a global binary no-retrieval gate.
- **GV-007 Main-model switching**: Replace a mocked main inference provider.
  Planning, retrieval, memory, evidence, embedding-index, storage, and
  diagnostics contracts remain unchanged.
- **GV-008 Embedding migration**: Change embedding provider, version, or
  dimensions. Lexical fallback remains available while the new versioned index
  builds; canonical messages and memories remain untouched.
- **GV-009 Memory-write negatives**: “Do you remember my rent?” and “Remember
  when we discussed graphs?” are reads; “I remember that algorithm” is neither.
  None creates a durable write. A user correction supersedes the prior memory
  with both source provenances retained.

GV-001 through GV-009 MUST resolve without invoking Tier 3, and automated golden
tests MUST assert `constrainedPlannerInvoked === false`.

Wave A golden tests use deterministic fixtures with injected or mocked state:
ledger state, active entities, image-reference candidates, explicit-memory
candidates, and lexical retrieval candidates. They assert the expected
`TurnPlan`, fallback, authority mode, and `constrainedPlannerInvoked === false`.
They do not claim end-to-end vision execution, ledger persistence,
explicit-memory persistence, or semantic-retrieval execution; those behaviors
are validated by Waves B, C, and D respectively.

### Mandatory failure and lifecycle scenarios

- The immediately following turn sees the just-completed ledger update; an
  existing conversation is never treated as a first turn merely because its
  ledger cache is missing.
- Cold start rebuilds a missing/stale ledger; corrupt ledger data does not alter
  canonical messages.
- Tier 3 cancellation, timeout, malformed output, low confidence, app
  suspension, and candidate-ID injection all take the FR-093 fallback.
- Process death during background indexing resumes from persisted progress while
  lexical retrieval remains available.
- Structured image extraction failure records partial/failed evidence and
  retains original-pixel reinspection.
- A comparison with one missing image identifies that side; a deleted asset with
  retained evidence is marked stale and is not represented as freshly inspected.
- Fresh pixel inspection excludes a previous assistant refusal as factual
  evidence.
- An exact lexical match recovers an explicit memory/fact when legacy routing
  incorrectly labels the turn independent.
- A source conversation excluded after creating a user memory cannot contribute
  that memory to cross-chat retrieval.

## 17. Revised Rollout Waves

### Wave A — Single authority foundation

Entry: corrected contracts and current legacy diagnostics baseline. Deliver:
`TurnPlan` MVP/validator, precise authority modes, shadow diagnostics, bounded
independent-routing recovery, Tier-3 contract, and deterministic golden
scenarios using injected/mocked ledger, entity, image-candidate,
explicit-memory, and lexical-retrieval state. Wave A asserts plans, fallbacks,
authority modes, and no Tier-3 invocation; it does not claim end-to-end vision,
ledger persistence, explicit-memory persistence, or semantic retrieval. Gate:
planner/authority gates default off. Exit: every supported fixture yields a valid
shadow plan; recovery protects all FR-086 sources; golden tests prove no Tier-3
call. Rollback: disable recovery/shadow gates and execute the complete legacy
turn. Focused tests cover plan schema/validation, modes, recovery, Tier-3 mocked
failures, and one-turn-one-authority. Physical validation is required for
Tier-3 cancellation/suspension/resource release before any controlled Tier-3
use.

### Wave B — Vision continuity

Entry: Wave A validator and controlled-mode whole-turn ownership for named image
classes. For each enabled image class, the validated plan owns reference
resolution, image selection, context-source selection, context assembly, vision
strategy, generation-task projection, and inference execution. Legacy semantic
routing is bypassed for the entire turn; the no-single-turn/two-authorities
invariant remains mandatory. Deliver image entities, all five vision strategies,
MVP structured evidence, persistence, follow-ups, reinspection, comparison, and
refusal exclusion. Gate: named image scenario classes only. Exit: image
golden/failure scenarios pass with separate identities and evidence status, and
the controlled-image authority test observes zero legacy semantic decisions.
Rollback: disable the image class gate and execute the complete legacy turn.
Focused tests cover whole-turn ownership, reference resolution, extraction
status, missing assets, refusal exclusion, and multi-image separation. Physical
device validation is required for fresh-pixel inspection, persistence,
reinspection, and comparison.

### Wave C — Ledger and explicit memory

Entry: Wave A plan/provenance contracts and canonical persistence hooks. Deliver
the versioned ledger, immediate memory writes, conservative detection, recall,
reliability, cold-start rebuild, ordering, deletion, retry/regeneration, and
supersession. Gates: ledger-read and durable-memory-write gates are separate.
Exit: the next turn sees the completed ledger update; memory goldens and false
write negatives pass without compaction/embeddings. Rollback: disable ledger
reads/writes and rebuild later from canonical data; canonical messages are never
rolled back. Focused tests cover transitions, restart, corrections, provenance,
reliability, and invalidation. Physical validation covers restart and immediate
next-turn behavior.

### Wave D — EmbeddingGemma and semantic retrieval

Entry: typed retrieval units and provider-independent embedding contract; it
does not require or block Wave E. Deliver artifact approval, provider adapter,
256/512 benchmark, versioned index/backfill, shadow semantic ranking, controlled
activation, and migration. Gates: provider, same-chat semantic, and cross-chat
semantic gates are independent. Exit: approved device evidence and quality gates
pass; lexical fallback passes every lifecycle state. Rollback: atomically
deactivate the new index/provider and continue lexical-only. Focused tests cover
descriptor compatibility, cancellation, stale vectors, restart-safe backfill,
atomic activation, and scope. Physical validation covers memory/latency/battery,
process death, pause for visible inference, and offline operation.

### Wave E — Authority transfer and cleanup

Entry: Waves A–C exit criteria and authority-transfer evidence; Wave D is
optional and may be unavailable, building, active, or completed. Deliver
authoritative mode, legacy bypass, semantic-regex removal, final diagnostics,
physical validation, then rollback-gate removal. Gates: global authority gate,
then rollback-removal gate. Exit: all supported turns have one new plan owner;
goldens/regressions pass in lexical-only mode and, if approved, semantic mode.
Rollback: until final physical acceptance, switch the whole turn back to legacy;
never mix paths. Focused tests cover authority ownership, provider substitution,
lexical-only operation, and absence of duplicate semantic decisions. Physical
validation is mandatory before disabling and later removing the rollback gate.

Wave D may occur before or after Wave E authority transfer. Embedding approval is
never on the critical path to planner authority. No wave contains a task that
simultaneously changes planning, vision, memory, retrieval, generation, queue,
and grounding.

## 18. Superseded Spec 007 Decisions

The following earlier Spec 007 decisions are explicitly superseded:

- `RequestClassification` as the authoritative semantic result and
  `ContextOrchestrator` as a place that may independently decide source needs.
- The pure-independent hard skip in FR-003/FR-004/FR-030 and related task text
  when interpreted as a binary switch that disables all context systems.
  Irrelevant context remains excluded, but retrieval and memory eligibility are
  field-level plan decisions with independent signals.
- The regex/lexical conversational-reference classifier described in
  `research.md` Section 2 and Assumptions as the primary semantic authority.
- FR-012a and related acceptance text that maps an ambiguous image reference to
  the active image. Ambiguous references now remain unresolved and are never
  guessed.
- The rule that query embedding occurs only after a deterministic
  long-context/cross-chat classification. Query embedding is now one semantic
  signal requested by the planner when useful, without a brittle binary gate.
- The assumption that semantic activation does not select an initial model.
  EmbeddingGemma is now the first provider to evaluate, while artifact approval
  and the dimension benchmark remain open.
- The claim that Qwen3-VL is an application-wide sole inference architecture.
  It remains the unchanged current provider behind a model-independent boundary.
- Any behavior that lets `InferenceQueue`, vision execution, generation
  planning, refusal recovery, or grounding independently reinterpret modality,
  intent, image strategy, or retrieval requirements.
- Any evidence policy that allows a normal direct-image turn to finish without
  either persisted reusable structured evidence or a guaranteed path back to
  the canonical original image.

## 19. Success Criteria

- **SC-001**: All nine golden scenarios produce the expected plan, selected
  context, provenance, and fallback results in automated contract fixtures; no
  scenario depends on final-answer wording and every fixture asserts Tier 3 was
  not invoked.
- **SC-002**: In the golden corpus, 100% of explicitly attached images and
  explicit memory writes survive unrelated low-confidence planner fields.
- **SC-003**: No ambiguous multi-image reference is silently mapped to an image
  in automated or physical validation.
- **SC-004**: Explicit memories are queryable immediately after source-message
  persistence, before compaction or embedding backfill.
- **SC-005**: Lexical retrieval remains operational throughout every tested
  embedding failure, pause, stale-index, and migration state.
- **SC-006**: Switching mocked main inference providers changes no planning,
  ledger, memory, retrieval-unit, embedding-index, or evidence schema.
- **SC-007**: Final prompt verification demonstrates required image/reference
  preservation and generation headroom using the active provider's native
  tokenizer for every golden fixture.
- **SC-008**: Final physical-device validation completes in airplane mode with
  zero inference-path network calls and no crash across planner failure, missing
  assets, embedding failure, cancellation, and provider-capability mismatch.
- **SC-009**: Planner authority transfer passes all authority/golden fixtures
  with the embedding provider unavailable and lexical-only retrieval active.
- **SC-010**: Every executed turn records one `authorityMode` and one
  `planOwner`; no fixture observes mixed legacy/new semantic ownership.
- **SC-011**: Tier-3 contract tests prove the deterministic gate, 96-token/8s
  budgets, cancellation/suspension handling, schema rejection, confidence
  threshold, candidate confinement, and conservative fallback.

## 20. Open Implementation Questions

- Which on-device runtime and quantization of EmbeddingGemma satisfy artifact
  licensing, NDK 26, New Architecture, latency, memory, battery, and cancellation
  requirements?
- Which of at least 256 and 512 dimensions provides the best measured
  quality/resource tradeoff for Locra's golden retrieval corpus?
- What bounded segment policy triggers early conversation summaries without
  duplicating or delaying explicit durable memory?
- Which structured image-evidence extraction policy balances first-turn latency
  against guaranteed follow-up reuse on 6–8GB devices?
- What thresholds combine semantic, entity, provenance, reliability, scope, and
  recency signals before controlled semantic retrieval becomes authoritative?
- What evidence threshold is sufficient to move from shadow planning to the new
  authoritative planner, and what rollback window is required afterward?

### Closed by this revision

- Tier-3 minimum schema, invocation gate, resource/generation/latency budgets,
  confidence threshold, and conservative failure behavior are defined in
  FR-091–FR-093. Model-output calibration may be benchmarked without changing the
  contract.
- Arbitrary canonical source-message editing is not part of Spec 007.
  `sourceRevision` and invalidation cover the lifecycle events listed in FR-051.
- Initial numeric hybrid-ranking weights remain a benchmark task; the ordinal
  reliability and exact-fact precedence rules in FR-055 are mandatory before
  calibration.
