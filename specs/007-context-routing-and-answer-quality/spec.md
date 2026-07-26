# Feature Specification: Context Routing and Answer Quality

**Feature Branch**: `007-context-routing-and-answer-quality`

**Created**: 2026-07-26

**Status**: Revised Draft (Audit Pass 2)

**Input**: User description: "Create a context router that selects the smallest useful context for each request, improving normal text conversations, long multi-turn conversations, new/follow-up image questions, OCR/counting/price/detailed-visual questions, voice-transcribed questions, optional cross-chat context sharing, and answer relevance/conciseness/grounding/repetition — incrementally, on top of the existing Spec 006 architecture."

## 1. Problem and Goals

Spec 006 built a deterministic hybrid-context pipeline (`ContextOrchestrator`, `HybridRetriever`, `EmbeddingService`, `ImageEvidencePolicy`, `AnswerPostProcessor`) but four gaps limit answer quality today:

- **The router always assembles the same fixed set of sources.** `ContextOrchestrator.orchestrate()` unconditionally attempts recent turns, media evidence, same-chat retrieval, durable facts, and an older-range summary for every request, regardless of whether the request is independent and self-contained. There is no classification step that decides "this request needs none of that."
- **Semantic retrieval is wired but inert in production.** `HybridRetriever` and `EmbeddingService` exist and are unit-tested, but no caller ever produces a query-time vector (`ContextOrchestrationOptions.queryVector` is never populated outside tests) and the runtime orchestrator is built with no embedding manifest. Every retrieval call in the shipped app silently falls back to lexical-only matching. Likewise, `ImageEvidencePolicy.evaluateImageEvidenceAvailability` — the pure function that should decide "re-run the original image through the Qwen vision path" vs. "reuse stored evidence" vs. "original unavailable" for pixel-dependent questions (OCR, counting, prices, detailed visual reads) — is fully tested but never called from `ContextOrchestrator`.
- **Context budgeting is character-only, not model/token-aware.** `ContextOrchestrator`'s `CharacterContextBudgetPolicy` measures raw character counts (`contextBudgetUnits` of 4,000 / 7,000 / 11,000 for Low/Medium/High) to decide what the router includes, while a separate, later trimming pass (`ContextWindow.trimMessagesToContextWithReport`) estimates actual tokens (`Math.ceil(length / 3)`) against the real Qwen context window (`QWEN_CONTEXT_TOKEN_LIMIT` = 4096 tokens, minus the generation reserve). These two measurements are not calibrated against each other, and neither reserves distinct capacity for system instructions, current input, image input, selected context, and generated output — so the router can select a source set that fits its own character budget yet still gets silently re-trimmed downstream against the real token limit.
- **Cross-chat context was removed, not deferred.** Spec 006 Phase 13 (T100) deliberately removed all alternate-conversation selection from the UI, requests, stores, retrieval budgets, and evaluation cases because the one-chat-at-a-time picker leaked complexity and correctness risk. There is currently no path — opt-in or otherwise — for relevant context to cross conversation boundaries.
- **Answer-quality control stops at post-hoc repetition and truncation cleanup.** `AnswerPostProcessor` reliably catches literal looping and mid-sentence truncation after the fact, but generation itself has no task-sensitive length targeting beyond the three response modes, and nothing stops an emerging loop earlier during generation.

**Goals** — improve, without a rewrite:

- Normal text conversations receive only what they need, not the full fixed source set; independent, self-contained questions receive no unrelated history, facts, summaries, or image context unless the request contains a genuine reference to prior context.
- Long multi-turn conversations stay coherent and within budget as they grow.
- New image questions get correctly evidenced answers.
- Follow-ups about the current or an explicitly referenced older image resolve to the correct image, never a silently substituted one; a genuinely ambiguous image reference never silently guesses among older images.
- OCR, counting, price, label, and other detailed-visual questions trigger genuine re-inspection — the correct original local image passed through the Qwen multimodal vision path again — instead of stale evidence reuse when the original is available. Selecting an image ID or reusing stored evidence alone is never sufficient for these requests.
- Voice-transcribed questions are routed identically to typed text once transcribed.
- Users who explicitly opt in can get relevant context shared across their own chats, with per-conversation exclusion and zero leakage when the setting is off (the default) — delivered as a later, self-contained phase once same-chat routing, image continuity, and token budgeting are stable.
- Answers become more relevant, more concise for simple questions, longer only when the task needs it, less repetitive, and stop looping earlier — using runtime-verified generation controls — with deterministic grounding/hallucination checking available as a final, optional diagnostics-only phase.

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

## 3. Conversation Scenarios

### User Story 1 — Independent, self-contained questions receive zero conversational context (Priority: P1)

A user asks a question with no genuine reference to anything earlier — no pronoun, no "it"/"that", no continuation language — in a conversation that already has unrelated history, durable facts, a summary, or an attached image.

**Acceptance Scenarios**

1. Given a conversation with prior unrelated turns, durable facts, a rolling summary, and an unrelated attached image, when the user asks a question classified as an independent text question, then the router includes none of the following: prior turns, the rolling summary, durable facts, retrieved items, or image evidence — only the current request enters context.
2. Given the same conversation, if the question instead contains a genuine reference to prior context (e.g., "and what about the second one", "does that still apply"), it is classified as a text follow-up, not an independent question, and may receive recent turns.
3. The exported diagnostics for an independent-question turn show zero non-current-request sources even considered, not merely zero selected.

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
4. Given three or more images exist and the reference could plausibly mean more than one of them with no disambiguating detail, then the router treats the request as a same-image follow-up against the conversation's current active image rather than guessing among the older ones, and diagnostics record that the reference was ambiguous and how it was resolved.

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
- An image reference is genuinely ambiguous among three or more prior images with no disambiguating detail: the router resolves to the current active image (same-image-follow-up rules), never an arbitrarily chosen older image (Story 6, Section 5).
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
  - **same-image follow-up** — refers to the conversation's current/active image without attaching a new one (including an ambiguous older-image reference resolved per FR-012a);
  - **older-image reference** — unambiguously references an earlier, non-active image;
  - **pixel-dependent visual request** — OCR/text-reading, counting, price-reading, label-reading, or other detailed-visual-inspection language; may combine with any image classification above;
  - **long-context retrieval request** — the conversation exceeds the response mode's recent-turn floor and the question plausibly concerns earlier content;
  - **cross-chat-eligible request** — the cross-chat setting is enabled, the current conversation is not excluded, and the request is otherwise eligible for expanded scope (Section 7).

  A single request MAY carry more than one applicable classification at once (e.g., an older-image reference that is also pixel-dependent); the source-selection rules in Sections 5–8 key off the full applicable combination, not a single exclusive label.
- **FR-003**: A request classified as an independent text question MUST receive no prior turns, no rolling-summary content, no durable facts, no retrieved items (same-chat or cross-chat), and no image evidence — only the current request enters context — unless the request also carries another classification (e.g., it is simultaneously a new image question) that independently requires one of those sources.
- **FR-004**: For any request classified as a text follow-up, long-context retrieval request, or any image classification, the current request and applicable recent exact turns (up to the response mode's floor) MUST always take priority over every retrieved or summarized source; recent exact turns are never displaced by retrieval. A request classified purely as an independent text question has no recent-turn floor at all — FR-003 already reduces recent turns to zero for that request, so there is no floor to protect or to reduce (see FR-030 and Superseded Requirements).
- **FR-005**: Retrieval (lexical, semantic, or cross-chat) MUST be added to context only when at least one candidate meets the existing relevance threshold (lexical overlap greater than zero, or cosine similarity at or above `COSINE_SIMILARITY_THRESHOLD`); the router MUST NOT inject filler content when no candidate qualifies.
- **FR-006**: Router source-selection decisions MUST be deterministic — identical stored state, request text, response mode, cross-chat setting, and embedding version MUST produce identical classification, source selection, and ordering.

## 5. Image-Reference Requirements

- **FR-007**: The router MUST invoke image-evidence-availability resolution (extending `ImageEvidencePolicy.evaluateImageEvidenceAvailability`, which exists today but is not called from `ContextOrchestrator`) for every request carrying a new-image, same-image, older-image, or pixel-dependent classification, rather than leaving that decision unused.
- **FR-008**: "Use the original image" MUST mean the correct original local image file is passed through the Qwen multimodal vision path (via the existing `llama.rn` inference pipeline) again, producing fresh visual evidence for the current request. Selecting an image's ID, or reusing previously stored evidence text without re-running vision inference, is never sufficient to satisfy a pixel-dependent request.
- **FR-009**: A request classified as pixel-dependent MUST trigger the original-image re-inference behavior in FR-008 when the original asset is available, even when sufficient stored evidence already exists.
- **FR-010**: A follow-up question MUST resolve to the correct image — the active/current image by default for a same-image follow-up, or the specific image identified by an unambiguous older-image reference — and MUST NOT silently substitute a different image.
- **FR-011**: When the required original image is unavailable and the request is pixel-dependent, the router MUST cause the response to report the original as unavailable rather than answering from stale evidence or a substituted image.
- **FR-012**: When the required image is unavailable and the request is not pixel-dependent, stored evidence MAY answer the question if it is sufficient, consistent with existing Spec 006 evidence-reuse behavior.
- **FR-012a**: When an image reference could plausibly mean more than one prior image and the request contains no disambiguating detail (an ordinal, a description, or similar), the router MUST NOT guess among the older images. It MUST resolve the request as a same-image follow-up against the conversation's current active image, and diagnostics MUST record that the reference was ambiguous and how it was resolved (FR-037). This is the only case in which an "older-image reference" classification is deliberately not applied despite reference language being present.

## 6. Semantic and Hybrid Retrieval Requirements

- **FR-013**: The router MUST support three retrieval states per request: fused hybrid (embeddings available, fresh, and compatible with the current scope), lexical-only fallback (embeddings unavailable, stale, incompatible, still building, or a query-embedding call fails at runtime), and no-retrieval (no candidate meets the relevance threshold, or retrieval was not selected for this request). Any embedding failure MUST degrade to lexical-only fallback, never to a failed request.
- **FR-014**: When both lexical and semantic candidates are available, the router MUST fuse them into one ranked candidate list using one deterministic fusion-and-reranking method — combining lexical-overlap and cosine-similarity signals, deduplicating by source message, and keeping the higher-ranked instance — rather than letting semantic scoring silently discard an exact lexical match that the lexical-only path would have surfaced. Fusion MUST NOT replace or hide an exact lexical match on a name, number, price, date, or other identifier-like token present in the query (see FR-019a).
- **FR-015**: Query-time embedding generation MUST be added so `HybridRetriever` actually receives a query vector when the embedding runtime is active. Today no caller populates `ContextOrchestrationOptions.queryVector` in production, so hybrid retrieval always falls back to lexical-only regardless of embedding availability.
- **FR-016**: Semantic retrieval activation MUST remain gated behind the existing embedding-artifact approval process — covering model identity, license, artifact hash, dimensions, latency, memory, and device-compatibility verification, as established for this project. This feature defines and wires the routing, fusion, and query-time embedding path; it does not itself grant that approval, and no artifact of this feature may assert or imply that an embedding runtime is currently approved when it is not.
- **FR-017**: Embedding backfill MUST continue to run under the existing exclusive device resource policy (never concurrent with answer generation, compaction, or voice) and MUST NOT block answering — a request MUST use lexical fallback while backfill is incomplete.
- **FR-018**: Hybrid retrieval MUST support an expanded scope (current chat, plus opted-in, non-excluded cross-chat sources per Section 7) using the same scope-filter-before-scoring rule already required for same-chat retrieval, so enabling cross-chat scope never changes single-chat-only retrieval results when cross-chat is off.
- **FR-019**: Retrieved items from any scope MUST remain source-attributed and treated as untrusted content, consistent with the existing `[Untrusted source: conversation X, message Y]` formatting.
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
- **FR-030**: When assembled context would exceed the token budget, the router MUST evict lower-priority sources first in this order: cross-chat retrieved items, then same-chat retrieved items, then durable facts, then older-range summary entries, then — only for a request that has a recent-turn floor to begin with (i.e., not a pure independent text question, per FR-004) — the recent-turn floor itself. The current request and protected image evidence (FR-028) are never evicted under any circumstance. A pure independent text question has no recent-turn floor and therefore nothing in this eviction chain beyond "current request only" ever applies to it.

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

- **FR-037**: Turn diagnostics (`ContextSelectionDiagnostics` / `DiagnosticsBundleBuilder`) MUST record: the full set of applicable request classifications (Section 4), which of the eight sources were considered versus selected, the retrieval mode actually used (fused hybrid / lexical-fallback / none) and the reason, the image-evidence decision (use-original-via-reinference / use-evidence / original-unavailable / evidence-unavailable) plus whether the request was judged pixel-dependent, whether an image reference was ambiguous and how it was resolved (FR-012a), and whether cross-chat scope was active (once Phase 7 ships).
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
- **MV-008**: Ambiguous image reference — with three or more images and a reference with no disambiguating detail, the router does not guess among the older images; it resolves as a same-image follow-up against the current active image, and diagnostics record the ambiguity and its resolution.
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

- **Request routing**: classification into the eight categories (including combinations and the ambiguous-reference default), the independent-question zero-context rule, and deterministic repeatability of source selection given identical input/state/mode/embedding-version.
- **Image-reference and missing-image selection**: use-original-via-reinference vs. use-evidence vs. original-unavailable vs. evidence-unavailable, across available/missing asset and pixel-dependent/not-pixel-dependent combinations, the ambiguous-reference default (FR-012a), and that "use original" actually triggers a fresh vision-inference call rather than a label-only decision.
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
- The precise set of words/patterns that count as a "genuine reference to prior context" for the independent-question-vs-follow-up boundary is deferred to planning; the policy itself (ambiguous cases default conservatively to follow-up) is decided (Section 3 edge cases).
- Whether task-sensitive output limits (FR-032) should be a small fixed set of tiers or a continuous function of classification plus mode is deferred to planning.
- Whether the optional grounding/hallucination assessment (Phase 8), if ever built, should surface any visible signal to the user, or remain diagnostics-only indefinitely, is still open — and is explicitly not a blocking question for this feature's core delivery.
- The production embedding artifact's own approval (model identity, license, hash, dimensions, latency, memory, device-compatibility verification) remains a separate, still-pending gate that this spec does not resolve; Section 6's semantic-retrieval requirements activate once that approval lands.

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
- **An unconditional recent-turn floor applied to every request** is superseded: a request classified purely as an independent text question has no recent-turn floor to protect (FR-003, FR-004, FR-030). The floor remains fully protected, exactly as before, for every other classification.
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
- Qwen3-VL running through `llama.rn` as the sole inference runtime.
- Offline voice transcription (whisper.rn, record-then-transcribe, gated behind `VOICE_INPUT_ENABLED`).
- Local-only, zero-network privacy for every stage of capture, preprocessing, inference, retrieval, and persistence (Constitution I).
- Existing History, diagnostics export, model download/verification, generation cancellation, and interrupted-answer recovery flows.
- The existing UI theme and design system (`design/`); this feature's only new UI is the cross-chat toggle and exclusion control, built from existing tokens/components.

## Key Entities

- **Context Router / Routing Decision**: the per-request decision of which of the eight sources to include, extending `ContextOrchestrator`.
- **Request Classification**: one or more of independent text question / text follow-up / new image question / same-image follow-up / older-image reference / pixel-dependent visual request / long-context retrieval request / cross-chat-eligible request, computed from deterministic signals; combinable, not mutually exclusive.
- **Image-Reference Resolution**: the specific image (or "current active image" default, for an ambiguous reference) an image-related request resolves to, plus an ambiguity flag (FR-012a).
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
- Independent-vs-follow-up classification relies on deterministic lexical/pattern signals (pronouns, continuation phrases, their absence); ambiguous cases default conservatively to follow-up to avoid breaking a legitimate continuation.
- Fusion of lexical and semantic retrieval combines both signal types into one ranked list, with an explicit exact-match guarantee for names/numbers/prices/dates/identifiers, rather than letting semantic scoring override or hide a precise match.
- Semantic retrieval activation stays behind the pre-existing embedding-artifact approval gate; this feature closes the "component exists but is never wired at query time" gap and adds fusion, but does not itself approve or select the embedding model, and no part of this feature assumes that approval has already happened.
- Cross-chat memory is a single global opt-in setting plus a per-conversation exclusion flag (not a per-message picker), matching the simplest, least-leaky design and deliberately avoiding the picker UX removed in Spec 006 Phase 13; it is explicitly sequenced after routing, image continuity, token budgeting, and same-chat semantic retrieval are stable (Phase 7).
- The grounding/hallucination assessment is explicitly deferred, optional, and diagnostics-only (Phase 8); nothing in Phases 1–7 depends on it, it never rewrites or suppresses an answer, and it remains a deterministic heuristic over already-available evidence/retrieved text rather than an additional model-inference pass.
- Request classification uses existing deterministic signals (message text patterns, attachment presence, explicit references, conversation length, settings state) — no new on-device classifier model is introduced by this feature.
- Voice-transcribed text is treated identically to typed text once it reaches the router; transcription confidence/quality is out of scope.
- All routing, retrieval, and (if built) grounding logic runs entirely on-device with zero network calls, consistent with the project's non-negotiable privacy architecture.
- This feature builds on and does not regress any Spec 006 functional requirement or success criterion; where this spec is silent, Spec 006's behavior stands (see Preserved Foundations).
