# Feature Specification: Unified Chat Experience

**Feature Branch**: `003-unified-chat-experience`

**Created**: 2026-07-09

**Status**: Draft

**Input**: User description: "Create Feature 003: Unified Chat Experience. The goal is to provide one coherent Locra conversation experience where users can start with text or optionally attach an image, continue multi-turn conversations, leave and resume conversations from local history, and move between conversations without context leakage."

## Clarifications

### Session 2026-07-09

- Q: What should happen to conversations/history that existed before this feature ships (from Feature 001/002's camera-first flow)? → A: No migration needed — the app is still in development with no production user data, so the unified conversation list starts fresh; no compatibility/migration work is in scope.
- Q: What concrete scale must conversation browsing and long conversations remain usable at? → A: Medium — approximately 200 conversations and 200 messages per conversation, used as a validation target, not a hard limit.
- Q: What happens when a response fails/errors on its own (not from the user navigating away) while the user stays in that conversation? → A: The failed attempt stays inline in the conversation with a visible failure indicator and an inline retry action that regenerates that same turn.
- Q: Should image attachment be restricted to a conversation's first message only? → A: No — an image may be attached on any user turn (first message or a later follow-up), at most one image per individual message; a later image-bearing turn does not create a new conversation or reset existing context.
- Q: Is single-flight inference scoped per-conversation, and does navigating away cancel an in-flight generation? → A: Single-flight is app-wide (only one inference ever in flight across the whole app, never multiple simultaneous requests). Navigating away does NOT cancel it — the in-flight generation continues in the background for its originating conversation, and its output is bound exclusively to that conversation; a second inference cannot start anywhere else until it completes or is explicitly cancelled from within its originating conversation.
- Q: What states can an assistant turn be in? → A: Four distinct states — generating/streaming, completed, failed, and interrupted (explicitly cancelled by the user) — each must be representable and distinguishable.
- Q: What happens to unsent drafts (typed text and/or an attached image) when the user switches conversations or backgrounds the app? → A: Preserved and restored exactly within the same app session; not required to survive a full app/process restart; never creates a drawer/History entry on its own.
- Q: What does retrying a failed response do? → A: Regenerates the same logical assistant turn — preserves the original user message unchanged, creates no duplicate user or assistant message, and transitions that same turn from failed back through generating/streaming to completed or failed again.
- Q: Is migrating pre-existing (Feature 001/002) conversation records into the unified list a required runtime behavior? → A: No — reclassified from a functional requirement to a non-goal; the app has no production users, so development data may be reset as needed and no migration implementation is required.
- Q: How are conversation titles, previews, and History search derived? → A: Title from the first meaningful user-visible text, with a deterministic fallback when the first message is image-only; preview from the most recent user-visible content; search is a local-only filter over titles and user-visible text — never from hidden traces or internal perception output.
- Q: Is the ~200 conversations / ~200 messages figure a hard product limit? → A: No — it is a validation dataset/usability target. Success is measured by observable outcomes (no crash, no missing/duplicate/reordered messages, correct isolation, usable navigation on the target physical device), not a vague "smoothness" claim.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start a conversation, with or without an image (Priority: P1)

A user opens Locra and starts a brand-new conversation. They can immediately type a question and send it, or they can attach a photo (captured or selected) and ask about it instead. Either way, they land in the same kind of conversation and get a streamed answer.

**Why this priority**: This is the entire reason the feature exists — one entry point that works whether the user's question starts as text or as an image. Without this, there is no unified chat experience, only two disconnected flows.

**Independent Test**: Can be fully tested by opening a new conversation, sending a text-only question, and separately opening another new conversation, attaching an image, and asking about it — both deliver a streamed answer inside a conversation.

**Acceptance Scenarios**:

1. **Given** the user opens a new, empty conversation, **When** they type a question and send it, **Then** their question appears in the conversation and a streamed answer follows without requiring any image.
2. **Given** the user opens a new, empty conversation, **When** they capture or select an image and ask a question about it, **Then** the image and question appear together in the conversation and a streamed answer follows.
3. **Given** the user sends an attached image without typing any accompanying text, **When** the request is submitted, **Then** the system still produces a relevant streamed answer about the image.
4. **Given** a response is currently streaming in this conversation, **When** the user attempts to submit another message in it, **Then** the system does not start a second, overlapping response for that conversation.
5. **Given** a response fails to generate while the user stays in the conversation, **When** the failure occurs, **Then** the failed attempt remains visible with a clear failure indicator and an inline retry action, and retrying regenerates that same assistant turn — without altering or duplicating the original user message and without creating an extra assistant turn.

---

### User Story 2 - Manage an image attachment before sending (Priority: P2)

Before sending, a user wants to see the image they attached to whatever message they're currently composing — whether it's the very first message of a conversation or a later follow-up — change their mind, and remove it, without losing anything else they were doing in that conversation.

**Why this priority**: Users need confidence to experiment with an attachment before committing to it, on any turn, not just the first. This directly protects trust in the composer and is called out explicitly as required behavior.

**Independent Test**: Can be fully tested by attaching an image on a conversation's first message and separately on a later follow-up, confirming it stays visible, removing it before sending, and confirming the conversation and any typed text are unaffected in both cases.

**Acceptance Scenarios**:

1. **Given** the user has attached an image to the message they're composing but not yet sent it, **When** they view the composer, **Then** the image remains visible until it is sent or explicitly removed.
2. **Given** the user has attached an image and typed accompanying text, **When** they remove the image, **Then** the conversation is not cleared or reset, and their typed text is preserved.
3. **Given** the user removes an attached image before ever sending a message in a brand-new conversation, **When** they check the conversation/History afterward, **Then** no empty or abandoned conversation is left behind.
4. **Given** the user has typed text and/or attached an image in one conversation without sending, **When** they switch to a different conversation and later return to this one, **Then** their unsent draft (text and/or image) is exactly as they left it.
5. **Given** an ongoing conversation with prior turns already exists, **When** the user attaches an image to a new follow-up message and sends it, **Then** the image-bearing turn is added to the same conversation without resetting or altering any earlier turn.

---

### User Story 3 - Continue a conversation with follow-up questions (Priority: P2)

After an initial answer, the user keeps asking follow-up questions in the same conversation — sometimes text-only, sometimes with a newly attached image — and reads the streamed replies as they arrive.

**Why this priority**: Multi-turn continuity is core to feeling like one coherent conversation rather than a series of one-off answers, regardless of whether any individual turn includes an image.

**Independent Test**: Can be fully tested by sending an initial question, receiving an answer, then sending at least one text-only follow-up and at least one image-bearing follow-up, and confirming both are answered within the context of the same conversation.

**Acceptance Scenarios**:

1. **Given** a conversation already has at least one completed answer, **When** the user sends a text-only follow-up question, **Then** the reply is generated within that same conversation, without the user having to re-attach any prior image or restate prior context.
2. **Given** a conversation already has at least one completed answer, **When** the user attaches a new image to a follow-up question, **Then** the reply is generated using that new image through the same perception-to-answer pipeline, and the turn is added to the same conversation without discarding earlier turns.
3. **Given** a conversation has an earlier image-bearing turn, **When** the user asks a later text-only follow-up that refers back to that image's content, **Then** the system answers using that turn's visible content without requiring the image to be re-attached.
4. **Given** an answer is actively streaming, **When** the user scrolls away from the bottom of the conversation to re-read earlier content, **Then** the view does not forcibly jump back to the newest content while they are reading elsewhere.
5. **Given** the user is scrolled near the bottom of the conversation while an answer streams, **When** new content arrives, **Then** the view follows the new content automatically.

---

### User Story 4 - Browse, switch, and resume conversations (Priority: P3)

A user with several past conversations opens the conversation drawer or full History, picks a previous conversation, and continues it — or starts a fresh one — with complete confidence that nothing from one conversation bleeds into another, even while a response is generating somewhere in the background.

**Why this priority**: This turns individual conversations into a coherent, trustworthy local history. It depends on Story 1 existing (there must be conversations to browse) but is independently testable as a navigation, concurrency, and isolation guarantee.

**Independent Test**: Can be fully tested by creating two or more conversations with distinct content, switching between them via the drawer and via History, and confirming each shows only its own messages; separately, by starting a response generating in one conversation, switching away from it, and confirming the response completes in the background and appears only in its own conversation.

**Acceptance Scenarios**:

1. **Given** the user has multiple past conversations, **When** they open the conversation drawer, **Then** they see their recent conversations and can select one to resume it.
2. **Given** the user selects a conversation from the drawer, **When** it opens, **Then** it restores exactly that conversation's own messages, in order, with no messages from any other conversation.
3. **Given** the user opens full History, **When** they select a past conversation, **Then** they resume it with its full visible message history intact.
4. **Given** the user starts a new conversation from the drawer, **When** the new conversation opens, **Then** it contains no messages, images, or context carried over from the previously active conversation.
5. **Given** the user switches away from a conversation and later returns to it, **When** they view it again, **Then** its content is unchanged and no content from any conversation visited in between has leaked into it.
6. **Given** the user has no past conversations yet, **When** they open History, **Then** they see a clear empty state rather than an error or blank screen.
7. **Given** a response is actively generating in one conversation, **When** the user switches to a different conversation, **Then** generation continues uninterrupted in the background for its originating conversation, and its output is never shown in, or mixed into, the conversation now on screen.
8. **Given** a response is actively generating in one conversation, **When** the user opens or is viewing a different conversation and attempts to send a message there, **Then** the system prevents a second generation from starting and indicates that generation is in progress elsewhere, while preserving the draft the user was composing.
9. **Given** a response finishes generating while the user is viewing a different conversation, **When** the user later returns to the conversation that was generating, **Then** the completed answer is already there, correctly attributed to that conversation, with no interruption to whatever the user was doing elsewhere.

---

### Edge Cases

- What happens when the user sends a second (or later) image-bearing message in a conversation that already has an earlier image-bearing turn? Each image-bearing turn MUST be perceived independently through the same perception-to-answer pipeline; later text-only follow-ups MUST be able to reference either image-bearing turn's visible content without re-attachment; no earlier turn or context is reset or discarded.
- What turn orderings MUST a single conversation support? At minimum: text-only turn followed by a text-only follow-up; an image-bearing turn followed by a text-only follow-up; a text-only turn followed by an image-bearing turn followed by a further text-only follow-up; and multiple image-bearing turns in one conversation (e.g., an image-bearing turn, a text-only turn, a second unrelated image-bearing turn, then a further text-only turn) — none of these orderings is a special case requiring different handling from any other.
- What happens when a response is generating in one conversation and the user switches to, or is already in, a different conversation? Generation MUST continue uninterrupted in the background for its originating conversation; its streamed output MUST NOT appear in, or be attributed to, whichever conversation is currently on screen.
- What happens if the user tries to send a message in a different conversation while another conversation's generation is in-flight? The system MUST block the send and indicate that generation is in progress elsewhere, without silently dropping or silently queuing the attempt; the user's draft MUST be preserved so they can send it once the app is free.
- What happens if the user returns to the conversation that was generating in the background? If generation is still running, they MUST see the live in-progress state; if it already finished while they were away, they MUST see the completed (or failed) answer already in place.
- What happens if the user explicitly cancels an in-flight generation? Cancellation is only available from within the generating conversation's own composer/stop control; the cancelled turn MUST show a distinct interrupted/incomplete state that is not confused with a normal failure or a completed answer.
- What happens when the user rapidly taps send multiple times in a row, in the same or a different conversation? Only one response MUST ever be produced app-wide per submission; no duplicate or overlapping responses may be created anywhere.
- What happens when a response fails or errors on its own (not from user cancellation)? The failed attempt MUST remain visible inline in the conversation with a clear failure indicator and an inline retry action that regenerates that same turn, rather than being silently dropped or shown only as a transient toast outside the conversation.
- What happens when the user retries a failed turn? The original user message MUST remain unchanged and MUST NOT be duplicated; no additional assistant turn is created; the same assistant turn transitions back through generating/streaming to completed or failed again.
- What happens to an unsent draft (typed text and/or an attached image) when the user switches conversations, opens the drawer or History, or backgrounds the app within the same app session? It MUST be preserved and restored exactly if the user returns to that conversation before sending it.
- What happens to an unsent draft if the app process restarts (e.g., killed and relaunched)? This feature does not require the draft to survive a process restart.
- What happens when the user attaches an image on any turn, then backgrounds or closes the app before sending anything? No partial or empty conversation should be left in the drawer or History if it was the conversation's first-ever message (FR-008/FR-032); if it was an unsent follow-up draft in an already-existing conversation, that conversation itself is unaffected and the draft behaves per the draft-preservation rules above.
- What happens when validated with a long conversation (~200 messages)? Resuming and scrolling it MUST NOT crash, drop, duplicate, or reorder any message, and MUST remain navigable on the target physical device.
- What happens when validated with a large number of stored conversations (~200)? Browsing the drawer and History MUST NOT crash and MUST continue to correctly isolate each conversation's content.
- What happens when the user searches in full History? Results MUST be limited to conversation titles and user-visible text content already stored locally — never hidden inference traces or internal perception output.
- How does the system behave with zero network connectivity while browsing, switching, resuming, or while a background generation is in flight? All of this MUST work identically, since none of it depends on a network connection.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST let a user start a brand-new, empty conversation that contains no messages, images, or context from any other conversation.
- **FR-002**: System MUST let a user send a text-only message, whether as a conversation's first message or as a later follow-up.
- **FR-003**: System MUST let a user capture or select an image and ask a question about it on any user turn — a conversation's first message or a later follow-up.
- **FR-004**: System MUST support at most one attached image per individual message, and MUST allow an image-bearing message to be sent with or without accompanying typed text.
- **FR-005**: System MUST treat every message within a conversation as belonging to one unified conversation type, regardless of whether an individual message is text-only, image-only, or text-plus-image.
- **FR-006**: System MUST keep an attached, unsent image visible in the composer until the user either sends it or explicitly removes it.
- **FR-007**: System MUST preserve the current conversation and any typed text when the user removes an attached image before sending.
- **FR-008**: System MUST NOT create a persisted conversation entry (visible in drawer or History) until the user has actually sent a first message; an abandoned, never-sent draft MUST leave no trace.
- **FR-009**: System MUST let a user send follow-up messages — text-only or image-bearing — within an existing conversation, without requiring any previously attached image to be re-attached or prior context to be restated.
- **FR-010**: A later image-bearing message MUST NOT alter, remove, or reset any earlier message, turn, or context already present in the conversation.
- **FR-011**: System MUST process every image-bearing turn, regardless of its position in the conversation, through the same perception-to-answer pipeline; hidden perception/extraction output for that turn MUST remain internal-only and scoped to that conversation; a later text-only follow-up MAY reference a prior image-bearing turn's visible content without the image being re-attached.
- **FR-012**: System MUST prevent a second inference from starting anywhere in the app while one is already in-flight, until that in-flight generation completes or is explicitly cancelled by the user from within its originating conversation.
- **FR-013**: While a response is streaming, System MUST NOT force the user's view back to the newest content if the user has scrolled away to read earlier messages; System MUST auto-follow new content only while the user is already at or near the latest content.
- **FR-014**: System MUST allow an in-flight generation to continue running for its originating conversation when the user navigates to a different conversation, the drawer, or History, and MUST write its streamed output only into that originating conversation.
- **FR-015**: System MUST attribute every generation — in-flight or completed — to the specific conversation and turn that started it, and MUST route its output only to that owner, never to whichever conversation happens to be on screen.
- **FR-016**: While a generation is in-flight anywhere in the app, System MUST indicate in any other conversation's composer that sending is unavailable until the in-flight generation frees up, and MUST NOT silently drop or silently queue a blocked send attempt.
- **FR-017**: System MUST provide a conversation drawer that lists the user's recent conversations and lets them select one to resume it.
- **FR-018**: System MUST provide a "start new conversation" action reachable from the drawer that opens a clean, isolated conversation.
- **FR-019**: System MUST provide a full History view listing all locally stored conversations, organized by recency, from which any conversation can be resumed.
- **FR-020**: When a user resumes a conversation from the drawer or from History, System MUST restore that conversation's own canonical visible messages, in their original order, and nothing else.
- **FR-021**: System MUST NOT carry over any visible message, image, hidden inference trace, internal prompt, streaming output, draft, or model request context from one conversation into another, in either direction, when the user creates a new conversation or switches between conversations — including while a different conversation's generation is running in the background.
- **FR-022**: System MUST NOT display internal perception prompts, extraction prompts, model traces, or intermediate visual evidence anywhere the user can see conversation content — including visible conversation history, drawer previews, and resumed conversations.
- **FR-023**: System MUST derive a conversation's title from its first meaningful user-visible text, using a deterministic fallback title when the first message is image-only (no text); System MUST derive a conversation's preview from its most recent user-visible content; neither the title nor the preview MUST ever be derived from internal-only state.
- **FR-024**: System MUST implement full History's search as a local-only filter over conversation titles and user-visible text content already stored on-device, and MUST NOT match against hidden inference traces or internal perception output.
- **FR-025**: All conversation drawer, History, switching, and resume functionality MUST work fully without a network connection and without requiring a user account.
- **FR-026**: System MUST display an explicit empty state when the user has no conversations yet, rather than an error or a blank screen.
- **FR-027**: System MUST implement the redesigned New Chat screen, Active Chat (including its generating/streaming state), the image attachment/preview state, the image-answer conversation state, the Conversation Drawer, and Full History using the screens, components, and interaction patterns already defined in the project's approved design sources, without introducing a parallel visual design system and without redesigning any screen not touched by this feature.
- **FR-028**: When a response fails to generate for a reason other than explicit user cancellation, System MUST retain the failed attempt inline in the conversation with a visible failure indicator, and MUST offer an inline retry action.
- **FR-029**: Retrying a failed assistant turn MUST regenerate that same logical turn — preserving the original user message unchanged, MUST NOT create a duplicate user message or an additional assistant turn, and MUST transition that same assistant turn from failed back through generating/streaming to either completed or failed again.
- **FR-030**: System MUST represent every assistant turn as being in exactly one of four states at any time — generating/streaming, completed, failed, or interrupted (explicitly cancelled by the user) — and MUST reflect the correct state whenever the conversation is viewed, resumed, or revisited after a background generation.
- **FR-031**: System MUST preserve an in-progress draft (unsent typed text and/or an unsent attached image) for a conversation across conversation switches and drawer/History visits within the same app session, and MUST restore that draft exactly if the user returns to that conversation before sending it.
- **FR-032**: System MUST NOT create a drawer/History entry for a New Chat draft that is never sent, no matter how many times the user switches away from it and back within the same app session.
- **FR-033**: System MUST support any ordering of text-only and image-bearing user turns within a single conversation — including, at minimum, text→text, image→text, text→image→text, and multiple image-bearing turns interleaved with text turns (e.g., image→text→image→text) — with no ordering treated as a special or unsupported case.
- **FR-034**: System MUST preserve, without regression, the existing two-stage perception-to-answer processing, canonical conversation ownership, bounded context assembly, and prevention of double-context injection that the current camera-first flow already relies on; this feature generalizes *when* an image-bearing turn can occur within a conversation, and does not replace, rewrite, or degrade the underlying inference-quality pipeline.
- **FR-035**: `Conversation.messages` MUST remain the permanent source of truth for conversation history. Context summaries, selected facts, and media evidence MUST be derived, versioned, regenerable data and MUST NOT replace, delete, reorder, or rewrite raw messages.
- **FR-036**: Before `ContextBuilder` assembles model messages, System MUST pass an isolated canonical conversation snapshot through `ContextOrchestrator`, which keeps recent completed turns verbatim and compacts only older completed turns when the configured input budget requires it.
- **FR-037**: Context budgeting MUST be owned by a replaceable `ContextBudgetPolicy`, with the initial implementation using deterministic character measurement. `ContextBuilder` MUST serialize the orchestrator's already-selected context and MUST NOT apply a second independent truncation policy.
- **FR-038**: Structured evidence derived by an image turn MUST be retained as internal, conversation-scoped derived memory keyed to its source user message, so later text-only turns may reuse relevant evidence without reattaching the image. The evidence contract MUST support future screenshot/document producers without changing canonical conversation ownership.
- **FR-039**: Selection of prior evidence, facts/decisions, and older summary entries MUST use deterministic lexical relevance followed by recency and stable identity tie-breaking. Selection MUST NOT require embeddings, a vector database, network access, or an additional model call per turn.
- **FR-040**: Context selection priority MUST be current request, recent exact turns, relevant media evidence, important facts/decisions, then older summary. Selected snapshots MUST be isolated from later mutation, preserved through refusal recovery/retry, and scoped to exactly one conversation.

### Key Entities

- **Conversation**: A single ongoing thread between the user and Locra. Holds a unique identifier, creation time, last-updated time, and its own ordered list of messages/turns. May contain zero or more image-bearing messages across any of its turns — not limited to the first — each processed independently through the perception-to-answer pipeline. Its title is derived from its first meaningful user-visible text (with a deterministic fallback if that message is image-only) and its preview from its most recent user-visible content; both derived from visible content only.
- **Message**: One turn within a conversation — either a user turn or an assistant turn. A user turn may carry multimodal content; for this feature, a user turn's content is limited to text, one attached image, or both — a feature-scoped functional limit, not an assumption baked into the conversation model itself, which does not preclude a future turn carrying additional or different content (e.g., multiple images, audio) from being introduced later without redefining what a "turn" is. An assistant turn carries a state — generating/streaming, completed, failed, or interrupted — enabling correct rendering, retry, and resume behavior. Every turn carries its content and a timestamp, and belongs to exactly one conversation.
- **Attachment**: An image attached to the message currently being composed, for any turn of a conversation. Exists in an "unsent" state (visible, removable, does not affect the conversation) until it is either sent (becoming part of that Message) or removed.
- **Draft**: The in-progress, unsent state of a conversation's composer — typed text and/or an attached image not yet sent. Preserved across conversation switches and drawer/History visits within the current app session; not required to survive a full app/process restart; never itself creates a drawer/History entry.
- **Conversation List**: The locally stored, chronologically organized collection of all of the user's conversations, groupable by recency, used to populate the drawer and full History, to resume any individual conversation, and to serve local title/text search.
- **Context Memory**: An optional, versioned, internal sidecar persisted with a conversation. Contains regenerable rolling-summary entries, fact/decision candidates, and structured media evidence; never replaces `Conversation.messages` and is never used for drawer titles, previews, or History search.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from opening the app to sending either a text-only or an image-attached first question in one continuous, unbroken flow, with no separate or disconnected entry points for the two.
- **SC-002**: 100% of newly started conversations contain zero messages, images, or context inherited from any other conversation, verified across repeated new-conversation and conversation-switching actions.
- **SC-003**: When validated against a dataset of approximately 200 stored conversations, browsing and switching between any two of them via the drawer or History shows the correct, fully isolated content every time, resumes correctly, with zero crashes, zero instances of another conversation's messages, images, or traces appearing, and usable scrolling throughout the list.
- **SC-004**: Resuming any past conversation from History restores its complete, correctly ordered visible message history in 100% of attempts, with no missing or extra messages.
- **SC-005**: In manual and automated review, internal perception prompts, extraction prompts, model traces, and intermediate visual evidence appear in visible chat, drawer previews, or History in 0% of cases.
- **SC-006**: A user can attach, preview, and remove an image before sending it — on any turn of a conversation, not only the first — in any order, without losing their conversation or typed text, in 100% of attempts.
- **SC-007**: While a response is streaming, rapid or repeated send attempts — in the same or a different conversation — never result in more than one response being generated across the entire app at a time.
- **SC-008**: A user who scrolls away from the latest content during streaming is not returned to the bottom of the conversation until they choose to scroll there themselves, in 100% of observed streaming sessions.
- **SC-009**: All conversation navigation, switching, and resume behavior functions identically with the device in airplane mode and without a signed-in account.
- **SC-010**: When validated against a conversation containing approximately 200 messages, the conversation does not crash, resumes correctly, and shows no dropped, duplicated, or reordered messages, with usable scrolling on the target physical device.
- **SC-011**: When a response fails to generate, the user can retry it inline from within the same conversation in 100% of observed failures, with the failed attempt visible until retried, and retrying never produces a duplicate user or assistant message.
- **SC-012**: When a generation continues after the user navigates away from its originating conversation, the completed answer is present and correctly attributed in that conversation in 100% of cases, with zero instances of it appearing in, or being confused with, any other conversation.
- **SC-013**: While one conversation's response is generating, attempts to start a second generation in any other conversation are blocked in 100% of attempts, with no more than one response ever generated across the entire app at a time.
- **SC-014**: The existing camera-first, single-image-conversation behavior (Feature 001/002) shows zero regressions after this feature ships — verified against the existing regression coverage for that flow — confirming this feature generalized rather than replaced the underlying inference-quality pipeline.
- **SC-015**: Automated context-orchestration coverage confirms that recent turns remain verbatim, older summary boundaries advance deterministically, relevant image/document evidence is selected within budget, retry preserves selected context, and no evidence from another conversation is admitted.

## Assumptions

- Images may be attached on any user turn — a conversation's first message or any later follow-up — with at most one image per individual message. This generalizes, rather than restricts, the existing single-perception-pass pipeline: each image-bearing turn gets its own independent perception pass, regardless of where it falls in the conversation.
- A conversation is only added to the drawer/History once its first message has actually been sent; an abandoned, never-sent draft (including one where an attached image was removed) leaves no visible trace (FR-008, FR-032).
- Conversation titles are derived from the first meaningful user-visible text, with a deterministic fallback label when the first message is image-only; previews are derived from the most recent user-visible content. Neither is user-authored in this feature.
- Only one inference may execute across the entire app at a time — app-wide single-flight, matching the constitution's Single-Flight Inference Queue principle, and never multiple simultaneous requests. Navigating away from the generating conversation does not cancel it: the single in-flight generation simply continues in the background, bound exclusively to its originating conversation, until it completes or is explicitly cancelled from within that conversation. Supporting this requires the app's existing single-active-thread state tracking to become conversation-attributed rather than a single global pointer; this is an architecture change to resolve during planning, not a reason to change this requirement.
- Per the approved design system, conversation rows in the drawer/History do not use unread badges; a conversation whose generation completed while the user was elsewhere is discovered by opening it, with no special "unread" indicator introduced by this feature.
- Local conversation history has no automatic expiry or count limit within this feature; conversations persist on-device until removed by a future feature or by clearing app data. Conversation deletion/management is out of scope for this feature.
- Legacy conversation migration is out of scope: the application has no production users or production conversation data, development conversation data may be reset as needed, and no migration implementation is required. This feature MUST NOT reject, delete, or reconcile old development data as a runtime behavior — it simply is not a concern this feature needs to handle.
- The conversation/turn model is described in terms of "a turn that may carry multimodal content" rather than a hardcoded text-plus-optional-single-first-message-image field pair, so that future modalities (multiple images per turn, audio input, other local modalities) are not architecturally precluded by this feature's data model. This feature does not add any of those future capabilities — the functional limit for Feature 003 remains exactly one image per user turn — it only avoids designing the domain model around the assumption that they can never exist.
- This feature is scoped as a generalization and behavior-preserving extension of the existing inference-quality pipeline (Feature 001/002), not a rewrite of it (FR-034, SC-014); the camera-first flow's current behavior remains protected by existing regression coverage throughout this feature's delivery.
- Approximately 200 stored conversations and approximately 200 messages within a single conversation are used as this feature's validation dataset/usability target (SC-003, SC-010) — not a hard product limit, and not sufficient justification on their own for adding pagination or virtualization infrastructure beyond what correctness at this scale requires.
- Full History's search is a local-only filter over already-stored conversation titles and user-visible text content — no new indexing service or external search capability is introduced.
- Context assembly is extended additively: raw messages remain canonical; `ContextOrchestrator` selects recent exact turns and derived memory under a replaceable budget before the existing `ContextBuilder` serializes model messages. XState remains workflow-only, and ExecuTorch remains stateless.
- An unsent draft (typed text and/or an attached image) is preserved only for the current app session (in memory, across conversation switches); it is not required to survive a full app/process restart.
- This feature does not add cloud sync, accounts, retrieval-augmented generation, embeddings, a vector database, agents, adoption of an orchestration framework (e.g., LangChain or LangGraph), a second model pass per request, a model-selection UI, multiple simultaneous inference requests (still exactly one in-flight generation app-wide at any time — see the single-flight assumption above), PDF ingestion UI, image generation, network search, developer diagnostic UI, benchmark UI, new model architecture work, model download lifecycle changes, a multi-image-per-turn UI, or new voice/audio capability work (existing voice functionality, if any, is unaffected and not extended by this feature).
