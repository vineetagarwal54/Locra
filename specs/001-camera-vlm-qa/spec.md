# Feature Specification: Camera Vision Q&A (Phase 1)

**Feature Branch**: `001-camera-vlm-qa`

**Created**: 2026-07-03

**Status**: Draft

**Input**: User description: "Build Locra Phase 1 — an Android app where a user captures a still image with their camera, types a question about it, and receives a streamed answer from a vision-language model running entirely on their device. Core user journey: open app, camera is ready, user points at something, types a question, taps submit, sees a streamed answer with performance metrics below it. The app must work in airplane mode from first inference onward. No network call is made during or after inference. No account, no login, no API key, no data leaves the device. The app has five screens: camera and prompt input, streamed answer with metrics, local Q&A history, model download and setup, and a benchmark visualization screen. The single hardest engineering problem in Phase 1 is memory-safe inference on a constrained Android device."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask a question about what the camera sees (Priority: P1)

A user opens the app, points the camera at something in the physical world, types a question about it, submits, and watches the answer stream in with performance metrics shown below it — entirely without an internet connection.

**Why this priority**: This is the complete core loop and the entire reason the app exists. Without it there is no product; every other screen exists to support, protect, or explain this loop.

**Independent Test**: With a compatible model already installed and the device verified compatible, capture an image, type a question, submit, and confirm a streamed answer with all performance metrics appears — verified while the device is in airplane mode.

**Acceptance Scenarios**:

1. **Given** the app is open with the camera ready and the model loaded, **When** the user captures an image, types a question, and taps submit, **Then** a streamed answer appears along with model load time, image preprocessing time, first-token latency, tokens per second, and total wall time.
2. **Given** the device is in airplane mode, **When** the user completes the full capture-question-answer flow, **Then** the answer is produced successfully with no network activity at any point.
3. **Given** an inference is currently streaming, **When** the user attempts to submit a new question, **Then** the system prevents the new submission until the current inference finishes or is cancelled.
4. **Given** an inference is in progress, **When** the user cancels it, **Then** streaming stops immediately, no partial answer is saved to history, and the app returns to a ready state for a new request.

---

### User Story 2 - Get set up on a new or incompatible device (Priority: P2)

A user launches the app for the first time, or on a device that cannot run the model, or with a missing/corrupted model file, and is guided to a clear setup or download screen instead of encountering a crash or a stuck screen.

**Why this priority**: Without this, unsupported devices crash outright and any user whose model is missing or corrupted has no path forward. This protects every user's first impression of the app.

**Independent Test**: Launch the app on a device profile below minimum requirements, and separately with the model file missing or corrupted, and confirm each situation routes to the correct screen without a crash.

**Acceptance Scenarios**:

1. **Given** a device that does not meet minimum memory or OS requirements, **When** the app launches, **Then** the user sees a setup screen explaining the device is unsupported, and no crash occurs.
2. **Given** a device that meets requirements but has no model installed, **When** the app launches, **Then** the user is routed to a download screen.
3. **Given** a previously downloaded model file has become corrupted, **When** the app attempts to load it, **Then** the user is routed to the download screen rather than experiencing a crash.
4. **Given** a model download is interrupted, **When** the user reopens the app, **Then** the download resumes without restarting from zero.

---

### User Story 3 - Review and manage past questions (Priority: P3)

A user revisits a local history of previous Q&A sessions and deletes entries they no longer want kept on the device.

**Why this priority**: Reinforces the local-only promise and lets users control their own device storage, but the app is still usable end-to-end without it.

**Independent Test**: Complete several ask flows, open the history screen, confirm entries appear with their metrics, delete one entry and then clear all history, and confirm the list updates immediately each time.

**Acceptance Scenarios**:

1. **Given** the user has completed several Q&A sessions, **When** they open history, **Then** all past sessions are listed with their questions, answers, and performance metrics.
2. **Given** a history entry exists, **When** the user deletes it, **Then** it no longer appears in history and is not recoverable through the app.
3. **Given** the user clears all history, **When** they reopen the history screen, **Then** it shows an empty state rather than an error.

---

### User Story 4 - Flag a bad answer (Priority: P4)

After receiving an answer, a user marks it as incorrect or unhelpful without navigating away from the current screen.

**Why this priority**: A quality-feedback signal for the user's own record; valuable but not required for the app's core function to work.

**Independent Test**: After receiving an answer, trigger the report action and confirm the session is marked as flagged without leaving the current screen and without any network activity.

**Acceptance Scenarios**:

1. **Given** an answer is displayed, **When** the user triggers the report action, **Then** the session is marked as flagged without navigating away from the current screen.
2. **Given** a session has been flagged, **When** the user later views it in history, **Then** it is visibly marked as flagged.

---

### User Story 5 - See performance trends (Priority: P5)

A user opens a benchmark screen and sees the recorded performance metrics visualized across their past sessions.

**Why this priority**: Informational and useful for understanding device performance, but the least critical to the app's primary purpose.

**Independent Test**: After several completed inferences, open the benchmark screen and confirm all five performance metrics are visualized or summarized across those sessions.

**Acceptance Scenarios**:

1. **Given** multiple completed Q&A sessions exist, **When** the user opens the benchmark screen, **Then** they see model load time, image preprocessing time, first-token latency, tokens per second, and total wall time visualized across those sessions.
2. **Given** no sessions have been recorded yet, **When** the user opens the benchmark screen, **Then** it shows an empty, informational state rather than an error.

---

### Edge Cases

- What happens when the user submits a question with no image captured, or an empty/blank question?
- What happens when the app is backgrounded or the device is rotated while an inference is in progress?
- What happens when the device runs out of memory mid-inference?
- What happens when free device storage is insufficient to complete a model download?
- How does the system behave when camera permission is denied or revoked?
- How does the system decide compatibility for a device that sits right at the minimum memory threshold?
- What happens if the model file passes integrity verification but the device still fails to load it (e.g., an unexpected runtime failure)?
- How does history behave once it grows very large — does browsing remain responsive?
- What happens if the user toggles airplane mode on or off during an active session (should have no effect, since no step of the flow depends on connectivity)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow the user to capture a still image using the device camera from the primary screen.
- **FR-002**: System MUST allow the user to enter a free-text question associated with the captured image before submitting.
- **FR-003**: System MUST allow the user to submit the captured image and question together as a single inference request.
- **FR-004**: System MUST produce the answer using only on-device processing; no step of image capture, preprocessing, model inference, or answer generation may depend on network connectivity.
- **FR-005**: System MUST display the answer as it is generated (streamed) rather than only after generation completes.
- **FR-006**: System MUST prevent a new inference request from starting while a previous inference is still in progress; the user must wait for it to finish or cancel it first.
- **FR-007**: System MUST allow the user to cancel an in-progress inference, after which the system returns to a ready state with no residual partial output.
- **FR-008**: System MUST record, for every completed inference, the model load time, image preprocessing time, first-token latency, tokens generated per second, and total wall-clock time.
- **FR-009**: System MUST display the recorded performance metrics to the user alongside the corresponding answer.
- **FR-010**: System MUST check device compatibility (available memory and OS support) before attempting to load the model.
- **FR-011**: System MUST present a dedicated setup screen, rather than crashing or hanging, when the device does not meet compatibility requirements, and MUST explain why inference is unavailable.
- **FR-012**: System MUST detect when the on-device model is missing or fails integrity verification and route the user to a download screen instead of attempting inference.
- **FR-013**: System MUST allow the user to download the required on-device model from the setup/download screen and MUST verify the downloaded model's integrity before making it available for inference.
- **FR-014**: System MUST support resuming an interrupted model download without restarting the download from zero.
- **FR-015**: System MUST persist a local record (history) of each completed Q&A session, including the question, the answer, and its performance metrics.
- **FR-016**: System MUST allow the user to browse their local Q&A history.
- **FR-017**: System MUST allow the user to delete an individual Q&A history entry and MUST allow the user to clear all history.
- **FR-018**: Deleted history entries MUST NOT be recoverable through the app after deletion.
- **FR-019**: System MUST allow the user to flag a specific answer as incorrect or unhelpful directly from the answer view, without leaving the app or requiring network access.
- **FR-020**: System MUST provide a benchmark screen that visualizes recorded performance metrics across multiple past sessions.
- **FR-021**: System MUST NOT require account creation, login, or an API key at any point in the app.
- **FR-022**: System MUST NOT transmit captured images, questions, answers, flags/reports, or usage metrics to any external service at any time.
- **FR-023**: System MUST respond to an out-of-memory condition during inference by returning to a clean, usable UI state with a clear error message rather than crashing.
- **FR-024**: System MUST prevent submission of a request that is missing a captured image or contains an empty question.

#### Phase 2 Additions (Post-MVP)

These requirements extend Phase 1's scope and, where noted, supersede specific
bullets in the Assumptions section below (see "Phase 2 Scope Note" at the end
of this document for the reconciliation).

- **FR-025**: System MUST continue an in-progress model download when the app is backgrounded, and MUST display a persistent Android notification showing download percentage and megabytes downloaded; tapping the notification MUST return the user to the model setup screen; pause/resume/cancel MUST remain available from the notification.
- **FR-026**: System MUST check the active network connection's type before starting a model download and, when the connection is cellular (metered), MUST present the user an explicit choice to wait for WiFi or proceed anyway before any download traffic begins; a user's choice to proceed on cellular MUST be persisted locally so they are not asked again on a subsequent resume of the same download.
- **FR-027**: System MUST verify downloaded model integrity via a chunked/streaming SHA-256 computation that never loads the full model file into memory at once, eliminating out-of-memory risk on constrained devices during the post-download integrity check.
- **FR-028**: System MUST fetch the expected model SHA-256 hash and file size from a hosted remote configuration endpoint at the start of each download attempt, rather than from a value hardcoded in the app binary, so the expected model version can change without an app release; this fetched configuration MUST NOT be cached between app sessions.
- **FR-029**: All iconography in production screens and components MUST use a vector icon library; no unicode glyph characters may be used as icons.
- **FR-030**: System MUST allow the user to ask one or more follow-up questions about the same previously-captured image without navigating away from the answer screen; the captured image MUST be attached only to the first question in the exchange, with follow-up questions sent as text-only turns; the full multi-turn exchange MUST be persisted as a single history entry.
- **FR-031**: System MUST allow the user to copy a completed answer's text to the system clipboard in a single action, with a haptic and visual confirmation, without navigating away from the current screen.
- **FR-032**: System MUST allow the user to share a completed question-and-answer pair as plain text via the native Android share sheet, without including the captured image and without any network activity.
- **FR-033**: System MUST allow the user to dictate a question via an on-device speech-to-text transcription rather than typing; the transcribed text MUST populate the question field for the user to review and edit before submitting; a voice transcription and a vision-language inference MUST NOT run concurrently.
- **FR-034**: System MUST offer a text-only fallback model on devices whose Device Compatibility Result indicates insufficient memory to run the vision-language model, so such devices retain a usable feature set instead of being blocked entirely.
- **FR-035**: System MUST allow the user to optionally attach a short free-text note (up to 120 characters) when flagging an answer, and MUST display that note alongside the flagged indicator when the session is later viewed in history.
- **FR-036**: System MUST allow the user to filter their local Q&A history by a case-insensitive substring match against the question text, updating the visible list as the user types, without issuing additional storage queries.
- **FR-037**: System MUST allow the user to pinch-to-zoom the captured image shown on the answer screen, within bounded zoom limits, and MUST reset the zoom level when the user navigates away from that screen.
- **FR-038**: System MUST present the user with a list of available on-device models, each showing its recommended status (based on device compatibility), storage size, and minimum RAM requirement, and MUST allow the user to select which single model is active at a time.

#### Phase 3 Additions (Multi-Turn Reliability, Vision-Once/Text-Chat, Resumable Threads)

These requirements extend Phase 2's multi-turn follow-up capability
(FR-030) with a reliability fix, a vision-once inference model, richer
context handling, full-thread persistence, and input/output quality tuning.
Where an item's exact underlying library capability is unconfirmed as of this
writing, `research.md`'s "Phase 3 API Verification" section is the source of
truth and this spec defers to it rather than assuming.

- **FR-039**: System MUST use exactly one long-lived inference-engine instance
  for the entire lifetime of the app process; every turn of every chat thread
  (first and follow-up) MUST be sent via that same instance's managed
  `sendMessage` call, and the instance MUST NOT be remounted, re-initialized,
  or re-`configure()`-d with a reset history mid-conversation.
- **FR-040**: System MUST be verifiable, via an automated test, that a second
  turn's effective request context (as observed through the engine's own
  conversation history or an equivalent inspectable request payload) includes
  the first turn's question and answer.
- **FR-041**: For the first turn following a new image capture, System MUST
  send the image together with a structured-extraction prompt instructing the
  model to identify, as labeled findings, the subject/object, its visible
  features, any visible text, and its visible condition; this extraction MUST
  be retained as pinned context for the remainder of that thread and MUST NOT
  be evicted by any later context-management step.
- **FR-042**: For every turn after the first in a thread, System MUST send a
  text-only request on the same engine instance (FR-039), constructed from
  the pinned extraction (FR-041) plus prior turns, without re-attaching the
  captured image.
- **FR-043** *(deferred — see Assumptions)*: System MUST offer a "Look again"
  action that re-runs the structured-extraction step (FR-041) against the
  thread's original stored image without starting a new thread. This is
  specified now so it is not re-litigated later, but it is explicitly
  deferred to a separate future task per the Phase 3 Scope Note below.
- **FR-044**: When constructing the message context for any turn, System MUST
  include the pinned extraction (FR-041) plus at minimum the most recent K
  verbatim turns (a sliding-window floor), and MUST NOT silently drop the
  pinned extraction to make room for additional history. Rolling
  summarization of turns older than the window is out of scope for this
  batch of work (see Phase 3 Scope Note).
- **FR-045**: System MUST persist each chat thread as a complete record —
  identifier, creation time, a reference to its captured image, and the full
  ordered list of turns — rather than a summarized or truncated form.
- **FR-046**: System MUST present an active chat thread through a single
  screen keyed by that thread's identifier; opening a thread from history
  MUST hydrate its full persisted turn list and allow the user to continue
  it with further follow-up turns, using the same continuation path as a
  thread that was never left.
- **FR-047**: When the user navigates away from an active chat thread, or
  begins a new image capture, System MUST ensure the current thread's
  latest state is already committed to history, then MUST reset any active-
  chat state to a clean slate before a new capture's first turn begins; a
  freshly captured image MUST NOT retain any turn, extraction, or context
  from a prior thread.
- **FR-048**: System MUST interrupt any in-flight generation before its chat
  screen unmounts (navigation away or app teardown), so no generation is ever
  left running unobserved after the user has left that screen.
- **FR-049**: System MUST preprocess a captured image before it is handed to
  inference: correct its orientation per embedded orientation metadata, crop
  to a subject region (or a sensible centered default when no subject region
  is available), and downscale to the existing resolution ceiling — all
  performed on-device with zero network calls. Contrast normalization applies
  only where the platform image API supports it; `research.md`'s Phase 3 API
  Verification (d) confirms the current RN-layer image libraries expose no
  contrast operation, so that sub-step is omitted until a vetted native
  module exists (see Phase 3 Scope Note).
- **FR-050**: System MUST send a system prompt that establishes the model's
  role and explicit negative constraints (answer only from what is visible in
  the image, do not speculate beyond it, keep answers concise), and MAY
  include a small fixed set of example exchanges to steer output formatting.
- **FR-051**: System MUST configure generation parameters for every inference
  call using only fields confirmed to exist on the installed library's
  generation-configuration surface (`temperature`, `topP`, `minP`,
  `repetitionPenalty`, `outputTokenBatchSize`, `batchTimeInterval` — see
  `research.md`); System MUST NOT reference a `topK` field anywhere, since
  `research.md`'s verification confirms it does not exist on the installed
  version.
- **FR-052**: Because the installed library exposes no native maximum-
  output-length or context-sequence-length setting (`research.md`
  verification), System MUST enforce an app-level output-length budget by
  observing the engine's generated-token count during streaming and stopping
  generation once a configured budget is reached, rather than assuming a
  native field for this exists.
- **FR-053**: For the structured-extraction turn (FR-041), System MUST
  prompt the model to produce a specific JSON-shaped response, attempt to
  parse the result as JSON, and — if parsing fails — retry generation exactly
  once with a corrective follow-up prompt before falling back to storing the
  raw text as an unstructured extraction; System MUST NOT depend on any
  native grammar- or schema-constrained decoding feature, since `research.md`
  confirms none exists on the installed version.
- **FR-054**: System MUST post-process every completed answer by trimming
  leading/trailing whitespace and detecting whether its tail appears
  truncated mid-sentence or looping on a repeated phrase, and MUST present an
  answer detected this way with a distinct, visible indicator rather than as
  an ordinary complete answer.

### Key Entities

- **Q&A Session**: A single ask-and-answer interaction — holds a reference to the captured image, the question text, the generated answer text, a timestamp, its status (completed, cancelled, or errored), and whether it has been flagged. **Phase 3**: also the persisted chat thread record (FR-045) — its full ordered turn list plus, once produced, the pinned structured-extraction result (FR-041) that every later turn's context is built from.
- **Performance Metrics**: The measured timing/throughput data for one Q&A Session — model load time, image preprocessing time, first-token latency, tokens per second, and total wall time.
- **On-Device Model**: The installed vision-language model asset — tracks its download status, integrity/verification status, and whether it is currently available for inference.
- **Device Compatibility Result**: The outcome of the compatibility check performed before model load — whether the device is supported, and the reason when it is not.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from capturing an image to seeing a completed streamed answer entirely while the device is in airplane mode, with zero network activity detected at any point in the flow.
- **SC-002**: On a device that does not meet minimum requirements, the app never crashes on launch and instead shows an explanatory setup screen, in 100% of launch attempts.
- **SC-003**: When the on-device model is missing or fails integrity verification, the user is routed to a download screen instead of experiencing a crash, in 100% of such cases.
- **SC-004**: 100% of completed inferences display all five performance metrics (model load time, image preprocessing time, first-token latency, tokens per second, total wall time) to the user.
- **SC-005**: A user can find and delete any past Q&A session from local history in two actions or fewer, and it never reappears afterward.
- **SC-006**: A user can flag an answer as incorrect in a single action without leaving the answer screen.
- **SC-007**: A user can view performance trends across their recorded sessions without leaving the app or needing any external tool.
- **SC-008**: Across a sustained sequence of 50 consecutive ask attempts on a supported device, every attempt ends in either a delivered answer or a graceful, explained error state — never an application crash.

## Assumptions

- Phase 1 ships with a single selectable on-device vision-language model; choosing between multiple models is out of scope for this feature.
- Flagging an answer as bad stores the flag and any accompanying note locally only; no report is transmitted anywhere, consistent with the zero-network requirement.
- No cap on local history size is enforced in Phase 1; the user manages device storage by deleting entries manually.
- Exactly one image may be attached per question; multi-image questions are out of scope (per the stated Phase 1 scope boundaries).
- The question is entered as typed text; voice input is out of scope for Phase 1.
- Downloading the on-device model is the only point in the app's lifecycle that uses network access; once the model is present and verified, every subsequent capture-question-answer flow is fully offline.
- "Unsupported device" is determined by a compatibility check (available memory and OS version) performed at launch, before any model load is attempted; the exact thresholds are a planning/implementation decision, not a product decision.

## Phase 2 Scope Note

The Assumptions above describe Phase 1's scope exactly as originally
delivered and are left unedited here for historical accuracy. FR-025 through
FR-038 (Phase 2 Additions, above) supersede the following three Assumptions
bullets specifically:

- "The question is entered as typed text; voice input is out of scope for
  Phase 1" — superseded by FR-033 (voice input via on-device transcription).
- "Phase 1 ships with a single selectable on-device vision-language model;
  choosing between multiple models is out of scope for this feature" —
  superseded by FR-034 and FR-038 (text-only fallback model, multi-model
  selector).
- The single-image constraint ("Exactly one image may be attached per
  question; multi-image questions are out of scope") is **not** superseded —
  FR-030's multi-turn follow-up flow explicitly keeps exactly one image per
  session, attached only on the first turn; every subsequent turn is
  text-only. This assumption remains fully in force.

All other Assumptions bullets remain in force unchanged.

## Phase 3 Scope Note

FR-039 through FR-054 (Phase 3 Additions, above) extend Phase 2's multi-turn
capability rather than replacing it — FR-030 remains in force; FR-039/FR-042
make explicit *how* its "same instance, text-only follow-ups" behavior must
be implemented so the context-loss failure mode this batch was commissioned
to fix cannot recur silently.

- **FR-043 ("Look again") is deferred, not built, in this batch.** It is
  specified so the requirement exists and is not forgotten, but no task in
  this batch's `tasks.md` implements it; it is tracked as a standalone future
  task to pick up once the vision-once/text-chat split (FR-041/FR-042) is
  live and stable.
- **Rolling summarization of context beyond the sliding-window floor
  (referenced in FR-044) is explicitly out of scope for this batch.** Build
  it only once a real conversation is observed overflowing the context
  window in practice — do not build it speculatively ahead of that evidence.
- **FR-051/FR-052/FR-053 are bounded by `research.md`'s Phase 3 API
  Verification findings, not by the feature input's original assumptions.**
  The feature input that commissioned this batch of work asserted `topK`,
  `maxTokens`, and `sequenceLength` as available, and assumed native
  grammar/JSON-constrained decoding might exist — `research.md` verified all
  three assumptions against the installed library and found none of them
  hold. FR-051/FR-052/FR-053 are written to the verified reality (app-level
  enforcement/parsing) rather than the original assumption, per Principle IX.
  If a future `react-native-executorch` upgrade bridges any of these
  natively, this spec should be revisited rather than the app-level
  workaround being kept out of inertia.
