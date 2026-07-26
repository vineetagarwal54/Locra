# Feature Specification: Context Routing and Answer Quality

**Feature Branch**: `007-context-routing-and-answer-quality`

**Created**: 2026-07-26

**Status**: Revised Draft

**Input**: User description: "Create a context router that selects the smallest useful context for each request, improving normal text conversations, long multi-turn conversations, new/follow-up image questions, OCR/counting/price/detailed-visual questions, voice-transcribed questions, optional cross-chat context sharing, and answer relevance/conciseness/grounding/repetition — incrementally, on top of the existing Spec 006 architecture."

## 1. Problem and Goals

Spec 006 built a deterministic hybrid-context pipeline (`ContextOrchestrator`, `HybridRetriever`, `EmbeddingService`, `ImageEvidencePolicy`, `AnswerPostProcessor`) but four gaps limit answer quality today:

- **The router always assembles the same fixed set of sources.** `ContextOrchestrator.orchestrate()` unconditionally attempts recent turns, media evidence, same-chat retrieval, durable facts, and an older-range summary for every request, regardless of whether the request is independent and self-contained. There is no classification step that decides "this request needs none of that."
- **Semantic retrieval is wired but inert in production.** `HybridRetriever` and `EmbeddingService` exist and are unit-tested, but no caller ever produces a query-time vector (`ContextOrchestrationOptions.queryVector` is never populated outside tests) and the runtime orchestrator is built with no embedding manifest. Every retrieval call in the shipped app silently falls back to lexical-only matching. Likewise, `ImageEvidencePolicy.evaluateImageEvidenceAvailability` — the pure function that should decide "re-run the original image through vision inference" vs. "reuse stored evidence" vs. "original unavailable" for pixel-dependent questions (OCR, counting, prices, detailed visual reads) — is fully tested but never called from `ContextOrchestrator`.
- **Context budgeting is character-based, not model/token-aware.** `ContextOrchestrator`'s `CharacterContextBudgetPolicy` measures raw character counts (`contextBudgetUnits` of 4,000 / 7,000 / 11,000 for Low/Medium/High) to decide what the router includes, while a separate, later trimming pass (`ContextWindow.trimMessagesToContextWithReport`) estimates actual tokens (`Math.ceil(length / 3)`) against the real Qwen context window (`QWEN_CONTEXT_TOKEN_LIMIT` = 4096 tokens, minus the generation reserve). These two measurements are not calibrated against each other, so the router can select a source set that fits its own character budget yet still gets silently re-trimmed downstream against the real token limit.
- **Cross-chat context was removed, not deferred.** Spec 006 Phase 13 (T100) deliberately removed all alternate-conversation selection from the UI, requests, stores, retrieval budgets, and evaluation cases because the one-chat-at-a-time picker leaked complexity and correctness risk. There is currently no path — opt-in or otherwise — for relevant context to cross conversation boundaries.
- **Answer-quality control stops at post-hoc repetition and truncation cleanup.** `AnswerPostProcessor` reliably catches literal looping and mid-sentence truncation after the fact, but generation itself has no task-sensitive length targeting beyond the three response modes, and nothing stops an emerging loop earlier during generation.

**Goals** — improve, without a rewrite:

- Normal text conversations receive only what they need, not the full fixed source set; independent, self-contained questions receive no unrelated history or image context at all.
- Long multi-turn conversations stay coherent and within budget as they grow.
- New image questions get correctly evidenced answers.
- Follow-ups about the current or an explicitly referenced older image resolve to the correct image, never a silently substituted one.
- OCR, counting, price, and other detailed-visual questions trigger genuine pixel-level re-inspection — the original image run back through vision inference — instead of stale evidence reuse when the original is available.
- Voice-transcribed questions are routed identically to typed text once transcribed.
- Users who explicitly opt in can get relevant context shared across their own chats, with per-conversation exclusion and zero leakage when the setting is off (the default) — delivered as a later, self-contained phase once same-chat routing is stable.
- Answers become more relevant, more concise, less repetitive, and stop looping earlier, with deterministic grounding/hallucination checking available as a later optional phase.

## 2. Non-Goals

- Rewriting or replacing SQL persistence, the immutable-message/retry-attempt model, the Qwen/llama.rn answer or vision pipelines, or the compaction/summary job — all established in Spec 006 and left in place.
- Reintroducing the removed per-message "select a past chat" picker UX (Spec 006 Phase 13, T100). Any cross-chat behavior in this feature is opt-in, global-by-default with per-conversation exclusion, and automatic — not a manual per-request picker.
- Implementing live/partial voice transcription. Voice input remains offline whisper.rn record-then-transcribe as already gated behind `VOICE_INPUT_ENABLED`; this feature only ensures transcribed text is routed like any other text input.
- Building a general-purpose retrieval system over arbitrary external documents, files, or the web. Retrieval scope is limited to this device's own conversation history (current chat, and opted-in, non-excluded other chats).
- Changing response-mode generation limits, the model, or the inference runtime. Modes (Low/Medium/High) keep their existing relative ordering; this feature changes what feeds those budgets and how those budgets are measured, not the underlying model or runtime.
- Selecting or approving the production embedding model artifact. That approval gate (manifest hash, license, device-compatibility verification) predates this feature and remains a separate, recorded decision this feature does not make.
- Shipping cross-chat retrieval (Section 7) or the deterministic grounding/hallucination assessment (Section 9) in the first delivery slice. Both remain in this feature's scope, but are explicitly sequenced as later, optional phases (Section 14) after same-chat routing, image continuity, token budgeting, and generation/repetition improvements are stable — neither may block or be a prerequisite for the earlier phases.
- New UI beyond a single global cross-chat-memory setting, a per-conversation cross-chat-exclusion control, and diagnostics fields already covered by the existing beta diagnostics export.

## 3. Conversation Scenarios

### User Story 1 — Independent, self-contained questions receive zero conversational context (Priority: P1)

A user asks a question with no conversational reference to anything earlier — no pronoun, no "it"/"that", no continuation language — in a conversation that already has unrelated history, durable facts, a summary, or an attached image.

**Acceptance Scenarios**

1. Given a conversation with prior unrelated turns, durable facts, a rolling summary, and an unrelated attached image, when the user asks a question classified as an independent text question, then the router includes none of the following: prior turns, the rolling summary, durable facts, retrieved items, or image evidence — only the current request enters context.
2. Given the same conversation, if the question instead contains a clear conversational reference (e.g., "and what about the second one", "does that still apply"), it is classified as a text follow-up, not an independent question, and may receive recent turns.
3. The exported diagnostics for an independent-question turn show zero non-current-request sources even considered, not merely zero selected.

---

### User Story 2 — Text follow-ups use only what the reference requires (Priority: P1)

A user asks a follow-up that depends on the immediately preceding exchange.

**Acceptance Scenarios**

1. Given a conversation where the previous turn established relevant context, when the user asks a follow-up carrying a clear conversational reference, then the router includes the recent turns needed to resolve that reference, without pulling in unrelated older material, retrieval, or image evidence unless the follow-up also references those.
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

### User Story 5 — Same-image follow-ups reuse evidence (Priority: P1)

A user asks multiple questions about the same image without re-attaching it.

**Acceptance Scenarios**

1. Given a prior image turn with stored evidence, when the user asks a same-image follow-up that is not pixel-dependent, then the router reuses stored evidence and does not reprocess the original image.
2. Given the same setup, when the follow-up carries no visual language and no reference to the image, the router does not attach image evidence just because an image exists in the conversation — it is classified as an independent text question or text follow-up instead.

---

### User Story 6 — Older-image references resolve to the correct image (Priority: P2)

A user has attached multiple images across a conversation and asks about an earlier one.

**Acceptance Scenarios**

1. Given two or more images in one conversation, when the user explicitly references an earlier image, then the request is classified as an older-image reference and the router resolves evidence/original for that specific image, never a different one.
2. Given the referenced image's original file is missing but its evidence still exists, when the follow-up is not pixel-dependent, then stored evidence answers the question and the response does not claim to have re-inspected the original.
3. Given the referenced image's original file is missing and the follow-up is also classified as pixel-dependent, then the response reports the original as unavailable rather than answering from stale evidence.

---

### User Story 7 — Pixel-dependent visual requests re-run the original image through vision inference (Priority: P1)

A user asks a question that depends on precise pixel content (reading text, counting items, reading a price, identifying fine visual detail) about an image already evidenced earlier in the conversation.

**Acceptance Scenarios**

1. Given existing stored evidence for an image and the original asset is still available, when the user asks a pixel-dependent visual request (e.g., "how many are in the box", "what does the label say", "what's the price"), then the router causes the original local image file to be passed through the vision-inference path again — producing fresh visual evidence for this request — rather than answering from the existing stored evidence text alone.
2. Given the same pixel-dependent request but the original asset is missing, then the response reports that the original image is unavailable instead of guessing from evidence.

---

### User Story 8 — Voice-transcribed questions route like typed text (Priority: P3)

A user records a voice message; it is transcribed into the editable draft and submitted.

**Acceptance Scenarios**

1. Given a transcribed and submitted voice message, the router applies the same classification, retrieval, image-reference, and budget rules as it would to typed text with identical content.
2. No voice-specific bypass or special-casing exists in the router; transcription quality is outside this feature's scope.

---

### User Story 9 — Cross-chat context only when explicitly enabled, delivered as a later phase (Priority: P3)

A user turns on a global setting to let relevant content from their other local conversations inform answers. This capability is scoped for delivery after same-chat routing (Stories 1–3), image continuity (Stories 4–7), token budgeting (Section 8), and generation/repetition improvements (Section 9) are stable (Section 14, Phase 7).

**Acceptance Scenarios**

1. By default (setting off), no request in any conversation ever includes content from another conversation.
2. After the user enables the setting, a request classified as cross-chat-eligible that has relevant content in another local, non-excluded chat may include that content as clearly source-attributed, untrusted retrieved text, scoped by the same relevance rules as same-chat retrieval.
3. After the user disables the setting again, the very next request in every conversation stops including cross-chat content, with no app restart required and no data loss.
4. Given cross-chat sharing is enabled globally, when a specific conversation is marked excluded from cross-chat retrieval, that conversation's content is never surfaced to other chats and that conversation never receives cross-chat content from others.

---

### User Story 10 — Generation stays concise, avoids repetition, and stops loops earlier (Priority: P2)

A user receives an answer that would otherwise loop, run long, or pad unnecessarily.

**Acceptance Scenarios**

1. Given a request classified as an independent text question or text follow-up with an objectively short expected answer, the applied output-length target favors the shortest complete answer rather than the response mode's full soft target merely because a longer mode is selected.
2. Given a raw answer that begins to loop, generation stops at or near the point the loop is detected rather than continuing to the hard token limit and being cleaned up only afterward.
3. Existing truncation/looping post-processing continues to run as a safety net and MAY be improved (e.g., earlier detection, adjusted thresholds) without being required to stay identical to today's implementation.
4. A future, optional phase (Section 14, Phase 8) MAY add a deterministic grounding/hallucination assessment; this story's generation and repetition improvements do not depend on it.

### Edge Cases

- A short, ambiguous reply with no explicit reference word (e.g., a bare "why?" or "are you sure?") is, by default, conservatively classified as a text follow-up rather than an independent text question, since defaulting to zero context risks breaking a legitimate continuation.
- The router's token-budget estimate and the existing downstream hard trim (`ContextWindow`) disagree: the router's own accounting MUST NOT allow a source set that the downstream trim would still need to silently cut; the two measurements are reconciled (Section 8).
- Embedding backfill is incomplete or in progress when a request arrives: retrieval falls back to lexical-only rather than waiting or failing.
- The cross-chat setting is toggled mid-conversation: the change applies starting with the very next request, not retroactively to context already assembled for an in-flight generation.
- A conversation is marked excluded from cross-chat while cross-chat is globally enabled: it behaves as fully isolated in both directions (neither contributing to nor receiving cross-chat content).
- An image is deleted (and its evidence removed per Spec 006 lifecycle rules) after a follow-up references it: the router treats it as unavailable, matching existing missing-file handling.
- A pixel-dependent request arrives while the single-flight inference queue is busy: it queues normally like any other inference request; it receives no special priority.
- Fusing lexical and semantic candidates produces overlapping results for the same source message: the router dedupes by source message, keeping the higher-ranked fused result.
- A voice transcript is garbled or ambiguous: the router treats it as ordinary text; no confidence signal changes routing in this feature (see Open Questions).
- Both an explicitly referenced image and a top cross-chat retrieved item would fit only one of them within budget: the explicitly referenced image is protected and always wins (Section 8).
- Cross-chat scope is enabled but the device has zero other eligible (non-excluded) conversations: retrieval behaves exactly as same-chat-only, with no error.
- A request combines multiple classifications (e.g., an older-image reference that is also pixel-dependent, or a long-context retrieval request that is also a same-image follow-up): all applicable sections' rules apply together, budgeted per Section 8's protection order.

## 4. Context-Routing Requirements

- **FR-001**: A single context router MUST decide, per request, which of the eight context sources (recent exact turns, rolling summary, structured facts, original image reuse, stored visual evidence, lexical retrieval, semantic retrieval, cross-chat memory) are included, replacing `ContextOrchestrator`'s current behavior of always attempting every applicable source.
- **FR-002**: The router MUST classify each request, using deterministic signals available at request time (message text, presence or absence of conversational-reference language such as pronouns and continuation phrases, attachment presence, explicit image reference, conversation length relative to the response mode's recent-turn floor, and the cross-chat setting/exclusion state), into the following categories — no network call and no additional model-inference request solely for classification:
  - **independent text question** — no conversational reference to prior turns, facts, summaries, or images;
  - **text follow-up** — a conversational reference to the immediately preceding exchange or nearby recent turns;
  - **new image question** — the current message itself carries a newly attached image;
  - **same-image follow-up** — refers to the conversation's current/active image without attaching a new one;
  - **older-image reference** — explicitly references an earlier, non-active image;
  - **pixel-dependent visual request** — OCR/text-reading, counting, price-reading, or other detailed-visual-inspection language; may combine with any image classification above;
  - **long-context retrieval request** — the conversation exceeds the response mode's recent-turn floor and the question plausibly concerns earlier content;
  - **cross-chat-eligible request** — the cross-chat setting is enabled, the current conversation is not excluded, and the request is otherwise eligible for expanded scope (Section 7).

  A single request MAY carry more than one applicable classification at once (e.g., an older-image reference that is also pixel-dependent); the source-selection rules in Sections 5–8 key off the full applicable combination, not a single exclusive label.
- **FR-003**: A request classified as an independent text question MUST receive no prior turns, no rolling-summary content, no durable facts, no retrieved items (same-chat or cross-chat), and no image evidence — only the current request enters context — unless the request also carries another classification (e.g., it is simultaneously a new image question) that independently requires one of those sources.
- **FR-004**: For any request classified as a text follow-up, long-context retrieval request, or any image classification, the current request and applicable recent exact turns (up to the response mode's floor) MUST always take priority over every retrieved or summarized source; recent exact turns are never displaced by retrieval.
- **FR-005**: Retrieval (lexical, semantic, or cross-chat) MUST be added to context only when at least one candidate meets the existing relevance threshold (lexical overlap greater than zero, or cosine similarity at or above `COSINE_SIMILARITY_THRESHOLD`); the router MUST NOT inject filler content when no candidate qualifies.
- **FR-006**: Router source-selection decisions MUST be deterministic — identical stored state, request text, response mode, cross-chat setting, and embedding version MUST produce identical classification, source selection, and ordering.

## 5. Image-Reference Requirements

- **FR-007**: The router MUST invoke image-evidence-availability resolution (extending `ImageEvidencePolicy.evaluateImageEvidenceAvailability`, which exists today but is not called from `ContextOrchestrator`) for every request carrying a new-image, same-image, older-image, or pixel-dependent classification, rather than leaving that decision unused.
- **FR-008**: "Use the original image" MUST mean the original local image file is passed through the vision-inference path again, producing fresh visual evidence for the current request — not a routing label that continues to answer from previously stored evidence text.
- **FR-009**: A request classified as pixel-dependent MUST trigger the original-image re-inference behavior in FR-008 when the original asset is available, even when sufficient stored evidence already exists.
- **FR-010**: A follow-up question MUST resolve to the correct image — the active/current image by default for a same-image follow-up, or the specific image identified by an older-image reference — and MUST NOT silently substitute a different image.
- **FR-011**: When the required original image is unavailable and the request is pixel-dependent, the router MUST cause the response to report the original as unavailable rather than answering from stale evidence or a substituted image.
- **FR-012**: When the required image is unavailable and the request is not pixel-dependent, stored evidence MAY answer the question if it is sufficient, consistent with existing Spec 006 evidence-reuse behavior.

## 6. Semantic and Hybrid Retrieval Requirements

- **FR-013**: The router MUST support three retrieval states per request: fused hybrid (embeddings available, fresh, and compatible with the current scope), lexical-only fallback (embeddings unavailable, stale, or incompatible), and no-retrieval (no candidate meets the relevance threshold, or retrieval was not selected for this request).
- **FR-014**: When both lexical and semantic candidates are available, the router MUST fuse them into one ranked candidate list — combining lexical-overlap and cosine-similarity signals, deduplicating by source message, and keeping the higher-ranked instance — rather than letting semantic scoring silently discard an exact lexical match that the lexical-only path would have surfaced.
- **FR-015**: Query-time embedding generation MUST be added so `HybridRetriever` actually receives a query vector when the embedding runtime is active. Today no caller populates `ContextOrchestrationOptions.queryVector` in production, so hybrid retrieval always falls back to lexical-only regardless of embedding availability.
- **FR-016**: Semantic retrieval activation MUST remain gated behind the existing embedding-artifact approval process (manifest hash, license, and device-compatibility verification, as established for this project). This feature defines and wires the routing, fusion, and query-time embedding path; it does not itself grant that approval.
- **FR-017**: Embedding backfill MUST continue to run under the existing exclusive device resource policy (never concurrent with answer generation, compaction, or voice) and MUST NOT block answering — a request MUST use lexical fallback while backfill is incomplete.
- **FR-018**: Hybrid retrieval MUST support an expanded scope (current chat, plus opted-in, non-excluded cross-chat sources per Section 7) using the same scope-filter-before-scoring rule already required for same-chat retrieval, so enabling cross-chat scope never changes single-chat-only retrieval results when cross-chat is off.
- **FR-019**: Retrieved items from any scope MUST remain source-attributed and treated as untrusted content, consistent with the existing `[Untrusted source: conversation X, message Y]` formatting.

## 7. Optional Scoped Cross-Chat Behavior

Cross-chat retrieval remains in scope for this feature but is delivered as a later, self-contained phase (Phase 7, Section 14), after same-chat routing (Sections 3–4), image continuity (Section 5), token budgeting (Section 8), and generation/repetition improvements (Section 9) are stable and validated. Nothing in this section may be a prerequisite for those earlier phases.

- **FR-020**: Cross-chat context sharing MUST be off by default and MUST require one explicit, global opt-in setting. No per-message or per-conversation picker is introduced; the alternate-conversation-selection UX removed in Spec 006 Phase 13 is not reintroduced.
- **FR-021**: A conversation MUST be individually markable as excluded from cross-chat retrieval. An excluded conversation MUST NOT contribute content to other conversations' retrieval and MUST NOT itself receive cross-chat content, even while the global setting is enabled.
- **FR-022**: When enabled, cross-chat retrieval scope MUST include only this device's local, non-excluded conversations and MUST apply the same relevance threshold, deduplication, fusion, and untrusted-source attribution as same-chat retrieval.
- **FR-023**: When disabled (the default, or after the user turns it off) or for an excluded conversation, the router MUST NOT include any cross-chat items and MUST NOT run cross-chat retrieval queries against or on behalf of that conversation; previously computed cross-chat-eligible embeddings/derived data MAY remain stored so re-enabling does not require rebuilding them.
- **FR-024**: Toggling the global cross-chat setting or a conversation's exclusion flag MUST take effect starting with the very next request, without an app restart and without losing any conversation state.
- **FR-025**: A conversation MUST never receive cross-chat content while the global setting is off or while that conversation is excluded, independently verifiable via zero other-conversation items in that turn's diagnostics.

## 8. Token-Budget Requirements

- **FR-026**: Context-selection budgeting MUST be measured in model tokens or a token-equivalent estimate calibrated against the existing Qwen/llama.rn token accounting already used for final input trimming (`ContextWindow.estimateMessageTokens`, `QWEN_CONTEXT_TOKEN_LIMIT`), replacing the router's current raw-character measurement (`CharacterContextBudgetPolicy`) as the basis for source-selection and eviction decisions.
- **FR-027**: The router's token-budget accounting and the existing downstream hard trim against the real Qwen context window MUST be reconciled into one consistent measurement, so the router never selects a source set that the downstream trim would still need to silently cut.
- **FR-028**: The current request text and any explicitly referenced or active image evidence MUST be protected within the token budget and MUST NOT be evicted to make room for any retrieved, summarized, or cross-chat source.
- **FR-029**: The existing per-response-mode budget tiers (Low/Medium/High) MUST continue to bound router output, re-expressed in token terms rather than characters; cross-chat retrieval MUST share the same mode-scoped retrieval limit rather than adding a separate, unbounded allowance.
- **FR-030**: When assembled context would exceed the token budget, the router MUST evict lower-priority sources first in this order: cross-chat retrieved items, then same-chat retrieved items, then durable facts, then older-range summary entries — before ever reducing the configured recent-turn floor, the current request, or protected image evidence.

## 9. Answer-Quality Requirements

- **FR-031**: The existing repetition and truncation detection (`AnswerPostProcessor`'s looping/truncated verdicts) MUST be preserved as a functioning baseline and MAY be improved (e.g., earlier detection, adjusted thresholds) — it is not required to remain byte-for-byte unchanged.
- **FR-032**: Output-length targeting MUST additionally consider the request's classification (Section 4), not only the response mode, so a request classified as an independent text question or text follow-up with an objectively short expected answer is not encouraged to reach the mode's full soft target merely because a longer-form mode is selected.
- **FR-033**: Repetition control SHOULD detect an emerging loop during generation and stop generation earlier, rather than relying solely on post-hoc cleanup after the full hard generation limit is reached.
- **FR-034**: Concise-by-default behavior MUST be reinforced by the request's classification: independent text questions and short text follow-ups favor the shortest complete answer, consistent with and reinforcing the existing mode instructions (`getResponseModeInstruction`).
- **FR-035**: Truncation/looping post-processing and the length/repetition controls above MUST run identically on answers informed by any source scope, including cross-chat context once Phase 7 ships — no answer path bypasses these controls.
- **FR-036**: A deterministic grounding/hallucination assessment (comparing an answer's specific claims — extracted text, counts, prices, named colors/objects — to included evidence/retrieved text) MAY be added in a later, optional phase (Phase 8, Section 14) and MUST NOT require a second model-generation pass when added. Implementation of FR-031 through FR-035, and of Sections 4–8, MUST NOT depend on or be blocked by this assessment existing.

## 10. Diagnostics Requirements

Routing diagnostics are the first phase of this feature (Phase 1, Section 14): they MUST be added before router behavior changes, so the team can observe what the router would decide alongside what today's fixed-assembly pipeline actually does, before switching behavior.

- **FR-037**: Turn diagnostics (`ContextSelectionDiagnostics` / `DiagnosticsBundleBuilder`) MUST record: the full set of applicable request classifications (Section 4), which of the eight sources were considered versus selected, the retrieval mode actually used (fused hybrid / lexical-fallback / none) and the reason, the image-evidence decision (use-original-via-reinference / use-evidence / original-unavailable / evidence-unavailable) plus whether the request was judged pixel-dependent, and whether cross-chat scope was active (once Phase 7 ships).
- **FR-038**: Diagnostics export MUST continue to sanitize local paths, exclude images by default, and disclose included conversation content exactly as today, extended to cover any cross-chat conversation identifiers introduced once Section 7 ships.
- **FR-039**: Diagnostics MUST remain exportable from persistence repositories rather than bounded UI caches, so router decisions for evicted or older turns stay inspectable after the fact, consistent with existing beta diagnostics behavior.
- **FR-040**: If and when the optional grounding/hallucination assessment (FR-036) is added, its verdict MUST appear in per-turn diagnostics alongside the existing truncated/looping verdict; until then, diagnostics MAY omit this field entirely without being considered incomplete.

## 11. Manual Validation Criteria

Manual conversation scenarios in the app, cross-checked against exported diagnostics, are the primary way this feature is validated. Each criterion below is directly observable through normal app use and/or the diagnostics export, and each phase (Section 14) is validated manually before the next phase begins.

- **MV-001**: Asking an independent text question in a chat with unrelated history, facts, a summary, and an unrelated image produces an answer with, per diagnostics, zero prior turns, zero summary content, zero facts, zero retrieved items, and zero image evidence considered.
- **MV-002**: Asking a follow-up with a clear conversational reference pulls in only the recent turns needed to resolve it, per diagnostics, without unrelated retrieval or image evidence.
- **MV-003**: In a conversation long enough to trigger summarization, asking about an earlier topic surfaces the relevant durable fact/summary/retrieved item (visible in diagnostics), while asking an independent question does not pull in unrelated older material.
- **MV-004**: Attaching a new image and asking about it produces visual evidence in the answer and in diagnostics; a same-image follow-up without visual language does not re-attach that evidence.
- **MV-005**: Asking a pixel-dependent follow-up (count/price/read-text) about a previously evidenced image causes the original image to be re-run through vision inference (visible as a fresh evidence record tied to a new inference in diagnostics), not answered from the old evidence text, when the original is still available.
- **MV-006**: Referencing an older image among several in one chat resolves to that specific image in the answer and diagnostics, never a different one; if its original file is removed, a pixel-dependent question about it reports the original as unavailable.
- **MV-007**: The router's token-budget accounting never selects a source set that the final model-context trim then has to silently cut further (confirmed via diagnostics showing consistent used/maximum units against the actual Qwen context window).
- **MV-008**: With the cross-chat setting off (default), no answer in any chat ever includes another conversation's content, confirmed by diagnostics across a multi-chat manual test. Turning the setting on and asking a question with genuinely relevant content in another local, non-excluded chat surfaces that content as attributed, untrusted context; marking a conversation excluded stops it from contributing to or receiving cross-chat content; turning the global setting back off stops all cross-chat inclusion on the very next message.
- **MV-009**: Voice-transcribed and submitted text produces the same routing behavior (per diagnostics) as typed text with identical content.
- **MV-010**: A raw answer that would loop is caught and stopped noticeably earlier than before (fewer wasted generation tokens), and a raw answer that would cut off mid-sentence is still cleaned up. An independent short-answer question does not receive a padded, mode-length answer.
- **MV-011**: Existing text chat, image chat, voice capture/transcription, History pagination and search, model download/verification, generation cancellation, checkpoint/recovery of interrupted answers, and offline/zero-network operation all continue to work exactly as before this feature (regression pass against Spec 006 acceptance scenarios).

## 12. Minimal Automated-Test Requirements

Automated tests are required only for small, deterministic, high-risk logic — not for AI response wording or end-to-end generation quality. Coverage is focused on exactly these areas:

- **Request routing**: classification into the eight categories (including combinations), the independent-question zero-context rule, and deterministic repeatability of source selection given identical input/state/mode/embedding-version.
- **Token-budget protection**: current request and active/referenced image evidence are never evicted; eviction order (cross-chat → same-chat retrieved → durable facts → summary entries) is enforced; the token-based measurement stays consistent with the downstream hard trim.
- **Image-reference selection**: use-original-via-reinference vs. use-evidence vs. original-unavailable vs. evidence-unavailable, across available/missing asset and pixel-dependent/not-pixel-dependent combinations, including that "use original" actually triggers a fresh vision-inference call rather than a label-only decision.
- **Cross-chat isolation**: off-by-default with zero leakage, per-conversation exclusion enforced in both directions, and immediate effect when the global setting or an exclusion flag is toggled.
- **Semantic/lexical fallback and fusion**: fallback to lexical-only when embeddings are missing/stale/incompatible/below threshold; correct fusion and deduplication when both lexical and semantic candidates are available, including that fusion never drops an exact lexical match.

**Explicitly does not require new automated tests for:**

- Exact wording, phrasing, or tone of any generated answer, and overall generation quality — both remain manual validation only (Section 11) and/or the existing evaluation harness in `src/evaluation`, never new unit/integration assertions.
- UI snapshot or pixel-level rendering tests for the cross-chat setting or exclusion control.
- Voice transcription accuracy (out of scope; already covered by Spec 006's voice validation metrics).
- The optional grounding/hallucination heuristic (Phase 8) — if and when it is implemented, its own focused tests are scoped at that time, not as part of this feature's initial minimal-test set.
- Precise timing of "earlier loop stopping" (FR-033) — validated manually/via the evaluation harness, not pinned to an exact token-count assertion.

## 13. Open Questions

- Exact token-budget numbers per response mode (Low/Medium/High), now that measurement moves from characters to tokens, need recalibration against the existing evaluation harness (`src/evaluation`) rather than being fixed in this spec.
- The precise conversational-reference heuristic (which words/patterns count as a "clear conversational reference" for the independent-question-vs-follow-up boundary) is deferred to planning; ambiguous short replies default conservatively to follow-up per Section 3's edge cases.
- Whether task-sensitive output limits (FR-032) should be a small fixed set of tiers or a continuous function of classification plus mode is deferred to planning.
- Whether the optional grounding/hallucination assessment (Phase 8) should ever surface a visible signal to the user, or remain diagnostics-only indefinitely, is still open.
- The production embedding artifact's own approval (manifest hash, license, device-compatibility verification) remains a separate, still-pending gate that this spec does not resolve; Section 6's semantic-retrieval requirements activate once that approval lands.
- Whether voice-transcribed input should carry a low-confidence signal that affects classification or grounding, or should always be treated identically to typed text as currently assumed, is still open.

## 14. Implementation Phasing (Non-Binding Sequencing)

This ordering guides future planning (`/speckit-plan`) and is not itself a task breakdown:

1. **Routing diagnostics** — instrument classification and source-consideration/selection visibility (Section 10) before changing any routing behavior, so today's fixed-assembly behavior can be observed and compared against.
2. **Image continuity and original-pixel reuse** — wire `ImageEvidencePolicy`, ensure correct image resolution across current/older images, and implement true original-image re-inference for pixel-dependent requests (Section 5).
3. **Minimal-context routing** — apply classification and source-selection rules so independent questions and follow-ups receive only what they need (Sections 3–4).
4. **Token budgeting** — move from character-based to token-aware budget measurement and reconcile it with the existing hard context-window trim (Section 8).
5. **Generation and repetition improvements** — task-sensitive output limits, earlier loop stopping, concise defaults, and improved (not merely preserved) post-processing (Section 9, excluding grounding).
6. **Same-chat semantic and hybrid retrieval** — query-time embedding wiring and fusion/reranking of lexical and semantic candidates, subject to the existing embedding-artifact approval gate (Section 6).
7. **Optional scoped cross-chat retrieval** — global opt-in, per-conversation exclusion, and expanded retrieval scope (Section 7), built once Phases 1–5 are stable.
8. **Optional grounding diagnostics** — deterministic unsupported/hallucinated-claim assessment surfaced in diagnostics only (Section 9's deferred item), built once the above are stable.

## Key Entities

- **Context Router / Routing Decision**: the per-request decision of which of the eight sources to include, extending `ContextOrchestrator`.
- **Request Classification**: one or more of independent text question / text follow-up / new image question / same-image follow-up / older-image reference / pixel-dependent visual request / long-context retrieval request / cross-chat-eligible request, computed from deterministic signals; combinable, not mutually exclusive.
- **Retrieval Candidate / Retrieved Item**: existing entities (`RetrievalCandidate`, `RetrievedItem`), now fused across lexical and semantic sources and, once Phase 7 ships, scoped across non-excluded chats.
- **Image-Evidence Decision**: use-original-via-reinference / use-evidence / original-unavailable / evidence-unavailable, plus a pixel-dependent flag, produced by the extended `ImageEvidencePolicy`; "use-original" always means a fresh vision-inference call on the original file.
- **Token Budget**: the router's context-selection accounting, measured in model tokens (or a calibrated token-equivalent estimate) and reconciled with the existing hard Qwen context-window trim.
- **Cross-Chat Memory Setting**: one global, persisted, on/off setting controlling cross-conversation retrieval scope.
- **Cross-Chat Exclusion Flag**: a per-conversation, persisted flag that removes a conversation from cross-chat retrieval in both directions regardless of the global setting.
- **Grounding/Hallucination Assessment** (optional, Phase 8): a per-turn deterministic verdict on whether the answer's specific claims are supported by included evidence/retrieved text.
- **Router Diagnostics**: the extension of `ContextSelectionDiagnostics` capturing classification, source selection, retrieval mode, image decision, and (once shipped) cross-chat usage and grounding verdict.

## Assumptions

- The router is an extension of `ContextOrchestrator`, not a replacement; existing budget-policy, evidence-repository, retriever, and fact/summary source interfaces are reused (`HybridContextSources`).
- Token-budget measurement uses either a native tokenizer call through the existing llama.rn/Qwen runtime binding if one is available, or a calibrated token-estimate heuristic consistent with the existing `ContextWindow.estimateMessageTokens` approximation — the exact mechanism is a planning-time decision, verified against current llama.rn capabilities before implementation (per this project's "verify before assuming" rule for native runtime APIs).
- Independent-vs-follow-up classification relies on deterministic lexical/pattern signals (pronouns, continuation phrases, their absence); ambiguous cases default conservatively to follow-up to avoid breaking a legitimate continuation.
- Fusion of lexical and semantic retrieval combines both signal types into one ranked list rather than letting semantic scoring override or hide an exact lexical match.
- Semantic retrieval activation stays behind the pre-existing embedding-artifact approval gate; this feature closes the "component exists but is never wired at query time" gap and adds fusion, but does not itself approve or select the embedding model.
- Cross-chat memory is a single global opt-in setting plus a per-conversation exclusion flag (not a per-message picker), matching the simplest, least-leaky design and deliberately avoiding the picker UX removed in Spec 006 Phase 13; it is explicitly sequenced after same-chat routing, image continuity, token budgeting, and generation improvements are stable (Phase 7).
- The grounding/hallucination assessment is explicitly deferred and optional (Phase 8); nothing in Phases 1–7 depends on it, and it remains a deterministic heuristic over already-available evidence/retrieved text rather than an additional model-inference pass.
- Request classification uses existing deterministic signals (message text patterns, attachment presence, explicit references, conversation length, settings state) — no new on-device classifier model is introduced by this feature.
- Voice-transcribed text is treated identically to typed text once it reaches the router; transcription confidence/quality is out of scope.
- All routing, retrieval, and (if built) grounding logic runs entirely on-device with zero network calls, consistent with the project's non-negotiable privacy architecture.
- This feature builds on and does not regress any Spec 006 functional requirement or success criterion; where this spec is silent, Spec 006's behavior stands.
