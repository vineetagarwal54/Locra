---

description: "Task list for Feature 003: Unified Chat Experience"

---

# Tasks: Unified Chat Experience

**Input**: Design documents from `/specs/003-unified-chat-experience/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Canonical model**: every task below operates on `Conversation.messages: ConversationMessage[]` — an ordered, role-tagged (`'user' | 'assistant'`) list where every message has a stable `id` (data-model.md). Ownership, streaming attribution, and retry are keyed by `conversationId` + `originatingUserMessageId` + `assistantMessageId` — never a positional turn index. The unified conversation route is `Chat` (`{ conversationId: string }`, with `'new'` as the not-yet-created-draft sentinel) — the old `Answer` route does not exist after this feature ships.

**Tests**: Included, but deliberately narrow. Most UI behavior in this feature will be validated manually on physical Android devices (Phase 9's checklist) rather than through automated UI-integration tests. Automated tests are reserved for logic that is high-risk or unreliable to validate by hand: the Phase 002 regression gate, XState lifecycle behavior, `ContextBuilder` correctness (including double-context-injection prevention), arbitrary-position image-turn behavior, conversation ownership/isolation, app-wide single-flight, retry correctness, background-generation attribution, and `ConversationSearch`'s pure functions — plus exactly one mixed-multimodal integration regression.

**Organization**: Tasks are grouped into a mandatory sequential foundation (research.md R11's protect → introduce XState → verify → generalize → multi-conversation → UI → validate ordering) followed by user-story phases. **The XState migration (Phase 2), the conversation/message generalization (Phase 3), the ownership/History generalization (Phase 4), and the UI redesign (Phases 5–8) are five separate, checkpoint-gated batches — do not collapse them.** Each foundational phase ends with a regression-gate checkpoint before the next begins, per research.md R9/R11.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no ordering dependency)
- **[Story]**: Which user story this task belongs to (US1–US4). Setup/Foundational/Polish tasks carry no story label.

## Path Conventions

Single Expo/React Native project — `src/`, `tests/` at repository root (no frontend/backend split). Exact paths below match plan.md's Project Structure.

---

## Phase 1: Setup

**Purpose**: Add the two new dependencies this feature requires, with the NDK/native-module verification the constitution's Development Workflow gate mandates before either is installed.

- [X] T001 [P] Add `xstate` ^5.x (core package only — no `@xstate/react`) to `package.json`; confirm it resolves as zero-dependency pure JS/TS with no native module (research.md R10)
- [X] T002 Verify `@react-navigation/drawer` and its required peer `react-native-gesture-handler` against the pinned NDK 26.3.11579264 and RN New Architecture compatibility (`findstr /r /s "ndkVersion" node_modules\react-native-gesture-handler\android\*.gradle` after a scratch install, per research.md R3 and AGENTS.md's NDK rule) before adding both to `package.json`
- [X] T003 [P] Run `npx tsc --noEmit`, `npx eslint src tests --ext .ts,.tsx`, and `npm test` on the current branch to capture a clean pre-feature baseline (quickstart.md §1; this is what T004 compares against)

**Checkpoint**: Dependencies installed and verified; clean baseline captured. No Feature 003 code has been written yet.

---

## Phase 2: Regression Protection & XState Migration (BLOCKING)

**Purpose**: Research.md R11 steps 1–3. Replace `InferenceQueue.ts`'s hand-rolled `status`/`setState` control flow with an XState v5 state chart, with the existing camera-first regression suite as the safety net — **before any conversation/message generalization is made.**

**⚠️ CRITICAL**: No conversation/message generalization (Phase 3) or conversation-ownership work (Phase 4) may begin until this phase's checkpoint is green.

- [X] T004 Confirm `tests/integration/vision-once-chat-flow.test.ts` and `tests/contract/inference-pipeline.test.ts` pass unmodified against today's pre-XState `InferenceQueue.ts` (research.md R9/R11 step 1 precondition) — do not proceed past this task until both are green
- [X] T005 [P] Write a failing **behavioral** contract test `tests/contract/turn-lifecycle-machine.test.ts` for the turn lifecycle machine, scoped to protect behavior and architecture boundaries without pinning internal structure. Assert: (a) valid lifecycle transitions (`idle → preparing → perception → contextAssembly → generating → streaming → completed | failed | interrupted`, with `RETRY` from `failed` looping back); (b) a `SUBMIT` while not `idle` is rejected — app-wide single-flight holds at the machine level; (c) `RETRY` reuses the same `conversationId`/`originatingUserMessageId`/`assistantMessageId` from the original request (only `requestId` may differ) rather than accepting new identities — no duplicate message is possible at this layer; (d) `completed`/`failed`/`interrupted` are mutually exclusive terminal states reachable from `streaming`/`generating`; (e) the machine's snapshot never exposes a full conversation or message list and is never written to MMKV — it does not become the canonical conversation store. Do **not** assert exact import structure, exact internal actor count, byte-identical implementation details, or an exact token-by-token snapshot sequence — those constrain safe internal refactoring without protecting behavior. Must fail before `turnLifecycleMachine.ts` exists.
- [X] T006 Create `src/inference/turnLifecycleMachine.ts`: XState v5 `setup()`/`createMachine()` state chart per research.md R10 and contracts/turn-lifecycle-machine.md. `TurnLifecycleContext.request` carries `{ requestId, conversationId, originatingUserMessageId, assistantMessageId, question, imagePath }` — no positional index anywhere in the context. Invoke the existing frozen `ExtractionPrompt.ts`/`AnswerPrompt.ts`/`SystemPrompt.ts`/`ExtractionParser.ts` unmodified via `fromPromise`/`fromCallback` actors.
- [X] T007 Reimplement `src/inference/InferenceQueue.ts` internals atop `turnLifecycleMachine.ts`: construct exactly one `createActor(turnLifecycleMachine).start()` per instance, translate actor snapshots into the existing `InferenceState` shape inside `subscribe()`; `IInferenceQueue`'s `submit`/`cancel`/`subscribe`/`getState` signatures in `src/types/interfaces.ts` stay unchanged in method shape (research.md R10/R11 step 2)
- [X] T008 Run `tests/contract/turn-lifecycle-machine.test.ts` to green against T006/T007
- [X] T009 Re-run `tests/integration/vision-once-chat-flow.test.ts` and `tests/contract/inference-pipeline.test.ts` **unmodified** against the XState-backed `InferenceQueue` — zero edits to their existing assertions permitted; a red run means the XState swap regressed behavior, stop and fix before continuing (research.md R9/R11 step 3, quickstart.md §1's first "twice" gate run)

**Checkpoint**: XState swap complete and independently verified behavior-preserving at the behavioral level. `InferenceQueue`'s public contract is unchanged; nothing about the conversation/message model or multi-conversation ownership has been touched yet.

---

## Phase 3: Conversation/Message Model & Arbitrary Image-Turn Generalization (BLOCKING)

**Purpose**: Research.md R11 step 4 (R2), plus the canonical data model (data-model.md). Establish `Conversation.messages: ConversationMessage[]` — ordered, role-tagged, stable-identity messages — and generalize the perception→answer pipeline to trigger per-message (any position) instead of per-turn-index. Sequenced strictly after Phase 2's checkpoint, per R11.

**⚠️ CRITICAL**: No conversation-ownership work (Phase 4) may begin until this phase's checkpoint is green.

- [ ] T010 [P] Add `ConversationMessage`/`Conversation`/`Attachment` types to `src/types/models.ts` per data-model.md's canonical model, replacing `QASession`'s `turns: {question, answer}[]` pair-array entirely:
  ```ts
  type AttachmentKind = 'image'; // only kind implemented in Feature 003; left open so a future kind (e.g. audio) doesn't require reshaping ConversationMessage
  interface Attachment { kind: AttachmentKind; path: string; }
  type MessageStatus = 'generating' | 'completed' | 'failed' | 'interrupted'; // FR-030's four states; meaningful for assistant messages, user messages are always 'completed' once sent
  interface ConversationMessage {
    id: string;                  // stable identity — generated at append time, same scheme as generateSessionId(); this is what ownership/retry/streaming key on, never a positional index
    role: 'user' | 'assistant';
    text: string;                // empty allowed only for an image-only user message, or a still-'generating' assistant message
    attachments: Attachment[];   // Feature 003 enforces at most one image-kind entry per user message at the UI/store layer (FR-004) — the array shape itself does not hardcode that ceiling; assistant messages never carry attachments
    status: MessageStatus;
    errorMessage: string | null;
    createdAt: number;
  }
  interface Conversation {
    id: string; createdAt: number; updatedAt: number;
    messages: ConversationMessage[]; // ordered; strictly alternates role starting with 'user' — both messages of a turn are appended atomically at submit time (the assistant message immediately in 'generating' status), per data-model.md's Message Creation Invariant; append-only except retry-in-place, which resets the trailing assistant message rather than appending a new one
    status: /* unchanged conversation-level rollup enum */; errorMessage: string | null; metrics: PerformanceMetrics | null; flagged: boolean; flagNote: string | null;
  }
  ```
  Keep this practical — do not build a generic attachment/content-part framework beyond the shape above; only `image` is implemented.
- [ ] T011 [P] Extend `src/types/interfaces.ts`: `InferenceRequest` gains required `requestId: string` (fresh per submit/retry, correlates `InferenceTrace` entries, never persisted), `conversationId: string`, `originatingUserMessageId: string`, and `assistantMessageId: string` (the assistant message this request writes into, created in `'generating'` status at submit time per the Message Creation Invariant); `imagePath` changes from required `string` to `string | null`. There is deliberately no `turnIndex` field anywhere in this interface (contracts/conversation-store.md).
- [ ] T012 Write failing unit tests in `tests/unit/inference/ContextBuilder.test.ts` covering: an image-bearing message at an arbitrary position (not only the first), a text-only follow-up correctly referencing a prior image-bearing message's visible content without re-attachment, the `imageA → text → imageB → text` ordering, and an explicit **double-context-injection** case — asserting the hidden perception-stage extraction for a given image-bearing message is never duplicated into a later message's prompt alongside its own already-derived visible text (research.md R2, FR-033, FR-034)
- [ ] T013 Extend `src/inference/ContextBuilder.ts`: replace the turn-index-based image check with a per-message `attachments.length > 0` check independent of position; image-bearing messages keep the existing two-stage perception→answer pipeline unchanged (including bounded prior canonical messages in the answer-stage call); text-only messages keep the existing `buildCanonicalModelMessages` continuation path unchanged; explicitly preserve the existing double-context-injection guard when generalizing the trigger condition (research.md R2/R9 frozen-file list — `ExtractionPrompt.ts`/`AnswerPrompt.ts`/`SystemPrompt.ts`/`ExtractionParser.ts` remain untouched)
- [ ] T014 Update `src/inference/InferenceQueue.ts`'s `submit()` to accept and pass the new `requestId`/`conversationId`/`originatingUserMessageId`/`assistantMessageId`/optional-`imagePath` request fields through to `turnLifecycleMachine`'s context opaquely (queue does not interpret them — contracts/conversation-store.md `IInferenceQueue` invariant 1)
- [ ] T015 Run `tests/unit/inference/ContextBuilder.test.ts` to green; re-run `tests/integration/vision-once-chat-flow.test.ts` unmodified a second time — this is R11's second independent regression-gate run, confirming the message-model generalization alone changed nothing about the existing turn-1 flow (research.md R11 step 3 second pass, quickstart.md §1)

**Checkpoint**: Any-position, any-ordering image branching over an ordered, identity-bearing message list is implemented and regression-verified. There is still exactly one global conversation pointer — no multi-conversation isolation exists yet.

---

## Phase 4: Conversation Ownership, Drafts, History & Isolation (BLOCKING)

**Purpose**: Research.md R11 step 5 (R1). Replace `inferenceStore.ts`'s single `activeSessionId`/`lastSavedSession`/`activeTurn` pointers with a conversation-keyed map attributed by stable message identity, add draft handling, and generalize `HistoryStore`/search to the canonical `Conversation.messages` shape. This is the last blocking phase before any UI work — every user story depends on it, and it carries the feature's core ownership/isolation guarantees so later UI phases don't need their own dedicated automated isolation tests.

- [ ] T016 [P] Extend `src/history/HistoryStore.ts` to persist the `Conversation` shape from T010 (`messages: ConversationMessage[]`, `updatedAt`) via the existing `history:ids` / `history:session:<id>` MMKV key convention; `list()` sorts by `updatedAt` descending (was `createdAt`); `save()` stays idempotent-by-id. **`list(limit?, offset?)` is explicitly the one pagination contract this feature relies on** — it already exists in `IHistoryStore`/`HistoryStore.ts` today and is fully implemented (loads, sorts, then slices `[offset, offset+limit)` or to the end); this task only changes the sort key and persisted shape, not the signature, so Phase 8's `HistoryScreen`/`ConversationDrawer` tasks may depend on it as-is — no other pagination API is introduced anywhere in this feature (data-model.md "History grouping and pagination", contracts/conversation-store.md `IHistoryStore`).
- [ ] T017 [P] Extend `tests/contract/history-store.test.ts` for the `Conversation.messages` shape, the existing structural boundary (no AsyncStorage/SQLite import, no cross-layer import from `../screens|inference|model`), and `list(limit, offset)`'s slicing correctness across a set larger than any single page — including a case confirming a conversation more than 7 days old is still returned (supports the `Older` History group, T047)
- [ ] T018 [P] Create `src/history/ConversationSearch.ts`: pure `deriveConversationTitle(conversation)`, `deriveConversationPreview(conversation)`, `searchConversations(conversations, query)` functions per contracts/history-search.md — title from `messages[0].text` (always the first **user** message, per the Message Creation Invariant), with a deterministic fallback when that message is image-only; preview from the most recent user-visible message content (the last assistant message's `text` if `status === 'completed'`, else the most recent user message's `text`); search is a case-insensitive substring match over `{title, every message's text}` only, typed to accept only the persisted `Conversation`/`ConversationMessage` fields so hidden inference content is structurally unreachable (depends on T010)
- [ ] T019 [P] Write `tests/unit/history/ConversationSearch.test.ts` covering contracts/history-search.md's invariants: title fallback for an image-only first message, the preview rule, case-insensitive substring search, empty query returns the unchanged list, and search never matches `errorMessage`/`metrics`/`attachments.path`/hidden inference content
- [ ] T020 [P] Write failing `tests/unit/store/conversationStore.test.ts` and `tests/contract/conversation-ownership.test.ts` covering `IConversationStore`'s invariants from contracts/conversation-store.md: single active owner across all conversations; `submit()` rejects/no-ops when owned elsewhere without touching the caller's draft or appending a message pair; no cross-conversation mutation of runtime state or draft; `startNewConversation()` isolation; draft round-trip after switching away and back; and `retryFailedMessage(conversationId, assistantMessageId)` resets the exact identified assistant message in place — reusing its paired `originatingUserMessageId` unchanged — rather than appending a new user or assistant message (FR-029, retry identity)
- [ ] T021 Create `src/store/conversationStore.ts` implementing `IConversationStore`: `Map<conversationId, ConversationRuntimeState>` and `Map<conversationId | 'new', Draft>`; `submit(conversationId, request)` appends a user message and its paired `'generating'` assistant message atomically and returns `{ conversationId, originatingUserMessageId, assistantMessageId }`; `retryFailedMessage(conversationId, assistantMessageId)`; `cancelActiveGeneration`/`isAnyGenerationInFlight`/`getActiveGenerationOwner`/`getDraft`/`setDraftText`/`setDraftImage`/`clearDraft`/`startNewConversation`; every read/write is keyed explicitly by its `conversationId` parameter, never an ambient "current conversation" (contracts/conversation-store.md invariant 8) — wraps `InferenceQueue` and `HistoryStore` (research.md R1) — depends on T010, T011, T016
- [ ] T022 Extend `src/store/inferenceStore.ts`: the subscription bridge that mirrors `InferenceQueue.subscribe()` now attributes streamed state into `conversationStore`'s map entry for the owning `conversationId` + `assistantMessageId`, instead of the old single `activeSessionId`/`lastSavedSession`/`activeTurn` module-scope pointers, which are removed (research.md R1) — depends on T021
- [ ] T023 [P] Write failing `tests/integration/background-generation.test.ts` covering contracts/inference-ownership.md's six scenarios, each asserted against the specific `assistantMessageId` involved (not array position): switch-away-mid-stream leaves the other conversation's state untouched; blocked `submit()` elsewhere preserves that conversation's draft; background completion is correctly attributed on return; live streaming state is visible on return while still generating; explicit cancel from the owning conversation → `interrupted` and frees the app-wide lock; rapid repeated `submit()` on the same conversation only ever produces one generation and one `assistantMessageId`. This test also stands in for two-conversation hydration coverage (no separate hydration test is needed once these scenarios are green).
- [ ] T024 Run `tests/unit/store/conversationStore.test.ts`, `tests/contract/conversation-ownership.test.ts`, and `tests/integration/background-generation.test.ts` to green against T021/T022

**Checkpoint**: Foundation complete. Conversation-keyed ownership (by stable message identity, never a position), drafts, retry identity, and generalized History/search all exist and are tested. **No screen has been touched yet** — this is the boundary before UI work (R11 step 6) begins. Ownership/isolation/single-flight are now proven at the store layer, so later UI phases validate their surface behavior manually rather than re-testing these guarantees.

---

## Phase 5: User Story 1 - Unified Chat UI (Priority: P1) 🎯 MVP

**Goal**: One entry point that works whether the user's first question is text or an attached image, landing in the same kind of conversation either way, with inline failure/retry, all reached through the single `Chat` route.

**Independent Test**: Open a new conversation, send a text-only question, and separately open another new conversation, attach an image, and ask about it — both deliver a streamed answer inside a conversation. **Validated manually on a physical device (Phase 9 checklist) — no dedicated automated integration test for this basic flow, since Phase 4 already proves the underlying store/ownership behavior automatically.**

### Implementation for User Story 1

- [ ] T025 [P] [US1] Create `src/components/chat/MessageBubble.tsx` (UserMessage/AssistantMessage variants, `theme.ts` tokens only, design.md §8)
- [ ] T026 [P] [US1] Create `src/components/chat/StreamingMessage.tsx` (generating/streaming state, three-dot indicator per motion.md §11.3)
- [ ] T027 [P] [US1] Create `src/components/chat/AssistantIdentityRow.tsx` (design.md §8)
- [ ] T028 [P] [US1] Create `src/components/chat/ImagePromptCard.tsx` (attached/sent image + question card, design.md §8)
- [ ] T029 [US1] Create `src/components/chat/ChatComposer.tsx` (text + attachment + mic + send, all composer states per design.md §9), reading/writing drafts via `conversationStore.getDraft`/`setDraftText`/`setDraftImage` — depends on T021
- [ ] T030 [US1] Create `src/screens/ChatScreen.tsx` generalizing `AnswerScreen.tsx` into the single conversation-scoped screen covering New Chat, Active Chat, Image Preview, and Image Answer states (design.md §7.8/7.9/7.11/7.12/7.13); subscribes to `conversationStore.subscribeToConversation(conversationId, ...)` per contracts/inference-ownership.md's UI contract, matching `ConversationRuntimeState.assistantMessageId` against the specific `ConversationMessage.id` being rendered rather than array position; **does not call `cancelActiveGeneration()` on unmount** — depends on T025–T029
- [ ] T031 [US1] Rename `RootStackParamList.Answer` to `Chat: { conversationId: string }` in `src/navigation/AppNavigator.tsx` ('new' sentinel for an as-yet-uncreated draft, per research.md R12); also widen `RootStackParamList.Capture` from `undefined` to `{ conversationId: string }` in the same file, since T033 requires `CaptureScreen` to receive that param (research.md R13); `ChatScreen` becomes the landing route in its New Chat state (`resolveInitialRoute()` points at `Chat` with `conversationId: 'new'`, not `Capture`); `WelcomeScreen.tsx` routes into `Chat` (`conversationId: 'new'`) instead of `Capture` once ready
- [ ] T032 [US1] Migrate `src/screens/HistoryScreen.tsx:53`'s `navigation.navigate('Answer', { sessionId })` call site to `navigation.navigate('Chat', { conversationId: sessionId })` (research.md R12) — this task exists independently of Phase 8's `HistoryScreen` rebuild so the route migration isn't silently dropped
- [ ] T033 [US1] Strip `src/screens/CaptureScreen.tsx` down to a camera-viewfinder-only screen: remove its own prompt input and its direct `inferenceStore.submit` call (line 108's `navigation.navigate('Answer', ...)` and the submit logic both move to `ChatComposer.tsx`); require a `conversationId: string` route param ('new' or an existing id); on capture, write the photo path directly into that specific conversation's draft via `conversationStore.setDraftImage(conversationId, path)` and navigate back — this guarantees the captured image is attributed to the conversation that opened the camera, never to whatever conversation happens to be active when the photo is taken (research.md R13)
- [ ] T034 [US1] Extend `src/components/chat/ChatComposer.tsx`'s attachment control to present the design source's Camera/Gallery/Cancel choice (design.md "Attachment Source Selection"): **Gallery** calls `useMediaStore`'s `pickImageFromLibrary()` inline (no navigation) and writes the result into this composer's own `conversationId`'s draft via `setDraftImage` — no navigation means no window for a conversation switch to race the result; **Camera** navigates to `CaptureScreen` with `{ conversationId }` (per T033) so the eventual capture is written back to the exact conversation that initiated it, even after intervening navigation elsewhere. Must work identically on a conversation's first message and on any later follow-up (research.md R13) — depends on T029, T033
- [ ] T035 [US1] Implement the inline failure indicator and inline retry action in `ChatScreen.tsx`/`MessageBubble.tsx` for a `failed` assistant message, calling `conversationStore.retryFailedMessage(conversationId, assistantMessageId)` (FR-028/FR-029)
- [ ] T036 [US1] Delete `src/screens/AnswerScreen.tsx` once `ChatScreen.tsx` fully replaces it; confirm no remaining references to `AnswerScreen` or the `Answer` route anywhere in navigation, stores, or tests

**Checkpoint**: User Story 1 is implemented — MVP. Every navigation call site that used to target `Answer` now targets `Chat` (T031/T032/T033). Validate manually per Phase 9's checklist before proceeding.

---

## Phase 6: User Story 2 - Attachment Behavior (Priority: P2)

**Goal**: See, change, and remove an attached image before sending — on a conversation's first message or any later follow-up — without losing the conversation or typed text.

**Independent Test**: Attach an image on a conversation's first message and separately on a later follow-up, confirm it stays visible, remove it before sending, and confirm the conversation and any typed text are unaffected in both cases. **Validated manually on a physical device (Phase 9 checklist) — no dedicated automated integration test for these UI scenarios.**

### Implementation for User Story 2

- [ ] T037 [US2] Implement image preview/remove controls in `src/components/chat/ChatComposer.tsx` and `src/components/chat/ImagePromptCard.tsx` — removal clears only the draft's `imagePath` via `conversationStore.setDraftImage(null)`, preserving typed text (FR-006/FR-007)
- [ ] T038 [US2] Wire `ChatScreen.tsx`/`ChatComposer.tsx` so switching away from and back to a conversation (including the not-yet-created New Chat slot) restores the exact draft via `conversationStore.getDraft` (FR-031)
- [ ] T039 [US2] Verify a never-sent New Chat draft (including one where the image was removed) creates no `HistoryStore` entry, relying on `conversationStore.startNewConversation()`'s isolation guarantee, already proven automatically in Phase 4 (FR-008/FR-032)

**Checkpoint**: User Stories 1 and 2 both implemented. Validate manually per Phase 9's checklist.

---

## Phase 7: User Story 3 - Mixed Multimodal Follow-Ups (Priority: P2)

**Goal**: Multi-turn continuity — text-only and image-bearing follow-ups both answered within the same conversation's context, with streaming that doesn't fight the user's scroll position.

**Independent Test**: Send an initial question, receive an answer, then send at least one text-only follow-up and one image-bearing follow-up, confirming both are answered within the same conversation's context.

### Tests for User Story 3

- [ ] T040 [P] [US3] Write **one** focused mixed-multimodal integration regression test in `tests/integration/unified-chat-flow.test.ts` covering exactly: `text → image A → text follow-up → image B → text follow-up`, asserting each reply stays correctly scoped to its own message (by `id`, not position), no earlier message is altered or reset, and both images' content remain distinguishable when later referenced (FR-009/FR-010/FR-011/FR-033). This is the one integration-level multimodal regression this feature keeps automated; all other US3 scroll/UI behavior is validated manually (Phase 9).

### Implementation for User Story 3

- [ ] T041 [US3] Implement multi-message rendering in `src/screens/ChatScreen.tsx`: virtualized `FlatList` of `ConversationMessage` entries in any ordering, each rendered via `MessageBubble`/`ImagePromptCard` per the message's own `attachments`/`status`, keyed by `message.id` (research.md R6)
- [ ] T042 [US3] Implement scroll-position-aware auto-follow behavior in `ChatScreen.tsx`: auto-scroll to newest streamed content only while the user is already at/near the bottom; never force-scroll while the user has scrolled away to re-read earlier content (FR-013) — validated manually (Phase 9), no dedicated structural test
- [ ] T043 [US3] Run `tests/integration/unified-chat-flow.test.ts` (T040) to green

**Checkpoint**: User Stories 1, 2, and 3 all implemented, with one automated mixed-multimodal regression green. Validate the rest manually per Phase 9's checklist.

---

## Phase 8: User Story 4 - Drawer, History, Switching & Resume (Priority: P3)

**Goal**: A conversation drawer and full History that browse, switch, and resume conversations with complete isolation, including while a response generates in the background elsewhere.

**Independent Test**: Create two or more conversations with distinct content, switch between them via the drawer and via History, confirming each shows only its own messages; separately, start a response generating in one conversation, switch away, and confirm it completes in the background and appears only in its own conversation. **Validated manually on a physical device (Phase 9 checklist) — the underlying ownership/isolation guarantees this depends on are already proven automatically in Phase 4 (T020/T023); no new dedicated automated test is added here to avoid duplicating that coverage.**

### Implementation for User Story 4

- [ ] T044 [P] [US4] Create `src/components/ConversationListItem.tsx` (shared row for drawer + History, design.md §8 "Cards and rows" — no unread badges, per the explicit design guardrail)
- [ ] T045 [US4] Create `src/navigation/ConversationDrawer.tsx`: recent conversations via `IHistoryStore.list(small limit)`, a "start new conversation" action calling `conversationStore.startNewConversation()` then navigating to `Chat` with `conversationId: 'new'`, a "view all history" link, and a Settings entry (design.md §6/§7.10); resuming a conversation navigates to `Chat` with its `conversationId` — never to `Answer` (research.md R12) — depends on T044
- [ ] T046 [US4] Extend `src/navigation/AppNavigator.tsx` to wrap the app in the Conversation Drawer navigator (`@react-navigation/drawer`, installed in T002) — depends on T045, T002
- [ ] T047 [US4] Rebuild `src/screens/HistoryScreen.tsx` with the four recency groups design.md §7.14 now defines — `Today` / `Yesterday` / `Previous 7 Days` / `Older` — computed at read time from each `Conversation.updatedAt`; every stored conversation MUST remain reachable, including everything in `Older` (FR-019, design.md: "Conversations older than seven days must not disappear"); local search via `ConversationSearch.ts`'s `searchConversations`; full-list access via `IHistoryStore.list(limit, offset)` (already defined in T016 — do not assume any pagination API beyond what T016 documents); explicit empty state (FR-019/FR-024/FR-026); resuming navigates to `Chat` with the selected `conversationId` — depends on T018, T044, T016
- [ ] T048 [US4] Implement the "generation in progress elsewhere" composer lock state in `src/components/chat/ChatComposer.tsx`, distinct from "this conversation is generating," preserving the blocked conversation's draft (contracts/inference-ownership.md point 2, FR-016) — validated manually (Phase 9), no dedicated automated UI-rendering test
- [ ] T049 [US4] Implement the cancel/stop control in `ChatScreen.tsx`/`ChatComposer.tsx`, rendered only when `conversationStore.getActiveGenerationOwner() === conversationId` for the currently displayed conversation (contracts/inference-ownership.md point 3) — validated manually (Phase 9), no dedicated automated UI-rendering test

**Checkpoint**: All four user stories implemented. The full unified chat experience UI (New Chat, Active Chat, Image Preview, Image Answer, Conversation Drawer, Full History with all four recency groups) is complete, every navigation call site targets `Chat`, and it's ready for the Phase 9 manual validation pass.

---

## Phase 9: Final Cleanup & Physical-Device Validation

**Purpose**: Final cleanup, full automated verification, and the mandatory physical-device manual validation pass (research.md R11 step 7, quickstart.md) that stands in for the automated UI tests this plan deliberately does not add.

- [ ] T050 [P] Update `src/store/historyStore.ts` (the Zustand wrapper) from the `QASession`/turn-pair type to `Conversation`/`ConversationMessage[]` (T010); remove any remaining reference to the deleted `src/screens/AnswerScreen.tsx` or the `Answer` route
- [ ] T051 [P] Run `npx tsc --noEmit`, `npx eslint src tests --ext .ts,.tsx`, and `npm test` — all retained contract/unit/integration tests must pass (quickstart.md §1)
- [ ] T052 Seed ~200 stored conversations (including some older than 7 days, to exercise the `Older` History group) and validate drawer/History browsing plus a single ~200-message conversation for crashes, drops, duplicates, or reordering (quickstart.md §2.7, spec SC-003/SC-010) **(device-required)**
- [ ] T053 Perform the full physical-device manual validation pass. This checklist absorbs the UI-behavior coverage this plan deliberately keeps out of automated tests, so treat every item as required, not optional:
  - Text-only first conversation, reached via the `Chat` route's New Chat state
  - Image-first conversation
  - Image-only message (no accompanying text)
  - Text → image → text follow-up
  - Image A → text → image B → text (cross-check against T040's automated regression)
  - Camera attachment via the Camera/Gallery/Cancel choice (first message and a later follow-up)
  - Gallery attachment via the same choice (first message and a later follow-up)
  - Remove an attached image before sending, confirming typed text and the conversation are preserved
  - Switch away from a conversation with an unsent draft and return, confirming the draft (text and/or image) is restored exactly
  - No History/drawer entry is created for an abandoned, never-sent New Chat
  - Switch between three or more distinct conversations via the drawer, confirming isolation
  - Resume a conversation through the drawer
  - Resume a conversation through full History
  - Local History search returns only the matching conversation(s)
  - Empty History state with zero stored conversations
  - History's `Today`/`Yesterday`/`Previous 7 Days`/`Older` groups all populate correctly, and a conversation older than 7 days is reachable in `Older`
  - Streaming auto-follows while the user is near the bottom of the conversation
  - Scrolling away during streaming does not force a jump back to the bottom
  - A generation started in conversation A continues in the background while viewing conversation B, and completes correctly attributed to A's specific message
  - Attempting to send in conversation B while A is generating is blocked app-wide, with B's draft preserved
  - The composer in B visibly indicates "generation in progress elsewhere," distinguishable from B's own generating state
  - Retrying a failed response regenerates the same assistant message with no duplicate user or assistant message
  - Explicitly cancelling a generation from within its own conversation shows an `interrupted` state, distinct from `failed`
  - Airplane-mode navigation, switching, and resume all behave identically to online behavior
  - Visual conformance against `design/design.md` and `design/references/*.png` for all touched screens, including Attachment Source Selection and the `Older` History group
  - Motion conformance against `design/motion.md` (transition/streaming/drawer timing)
  - The existing camera-first (Phase 002) flow behaves identically to before this feature — no regression
- [ ] T054 Final confirmation that `tests/integration/vision-once-chat-flow.test.ts`'s original turn-1-image assertions still pass unmodified end-to-end after all Feature 003 work (FR-034/SC-014 closing gate)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Regression Protection & XState Migration (Phase 2)**: Depends on Setup. BLOCKS Phases 3–8. Must reach its checkpoint (T009 green) before Phase 3 begins.
- **Conversation/Message Generalization (Phase 3)**: Depends on Phase 2's checkpoint. BLOCKS Phases 4–8. Must reach its checkpoint (T015 green) before Phase 4 begins.
- **Conversation Ownership, Drafts, History & Isolation (Phase 4)**: Depends on Phase 3's checkpoint. BLOCKS Phases 5–8.
- **User Stories (Phases 5–8)**: All depend on Phase 4's checkpoint. Once Phase 4 is green, US1 (Phase 5, Unified Chat UI) should be completed first as the MVP; US2 (Phase 6, Attachment Behavior)/US3 (Phase 7, Mixed Multimodal Follow-Ups) build on US1's `ChatScreen`/`ChatComposer` scaffolding (same files, sequential edits) so are listed next in priority order; US4 (Phase 8, Drawer/History/Switching/Resume) is independently addable last.
- **Final Cleanup & Validation (Phase 9)**: Depends on all four user stories being complete.

**This ordering is intentional and non-negotiable per the plan**: regression protection + XState migration → conversation/message generalization → conversation ownership and isolation → unified chat UI → attachment behavior → mixed multimodal follow-ups → drawer/History/switching/resume → final validation. Each foundational phase is gated by a green regression run before the next starts. Do not begin Phase 3 while Phase 2 is in flight, and do not begin any UI task (Phase 5+) until Phase 4's checkpoint is green.

### Within Each Foundational Phase

- Tests (contract/unit/integration) are written and confirmed failing before their corresponding implementation task.
- Regression re-run tasks (T009, T015, T024) gate progress to the next phase.

### Within Each User Story

- Shared chat components (T025–T028) before the composer/screen that consumes them (T029, T030).
- Route/navigation migration (T031/T032/T033) before behavior layered on top of it (T034/T035).
- Story implemented and manually spot-checked before moving to the next priority.

### Parallel Opportunities

- Phase 1: T001 and T003 in parallel; T002 sequential (shares `package.json` edits with T001).
- Phase 2: T004 and T005 in parallel (baseline check vs. new failing test); T006/T007/T008/T009 sequential (each depends on the prior).
- Phase 3: T010 and T011 in parallel (different files, no interdependency); T012 depends on the type shapes from T010/T011 so is not parallel with them; T013–T015 sequential.
- Phase 4: T016, T018, T020, T023 can start in parallel once T010/T011 land (different files); T017 depends on T010 and T016 (same conversation shape); T019 depends on T018; T021 depends on T010, T011, T016; T022 depends on T021; T024 depends on T021/T022.
- Phase 5 (US1): T025–T028 in parallel with each other (different component files); T029 depends on T021; T030 depends on T025–T029; T031–T036 sequential (shared navigation/screen/composer files, and each migrates a specific call site).
- Phase 6 (US2): T037–T039 sequential (same files as US1's composer/screen).
- Phase 7 (US3): T040 alone; T041–T043 sequential.
- Phase 8 (US4): T044 in parallel with nothing else in this phase (all other tasks share the navigation/screen/composer files); T045–T049 sequential.
- Phase 9: T050/T051 in parallel; T052/T053/T054 sequential (device validation, then final gate).

---

## Parallel Example: Phase 4 (Conversation Ownership, Drafts, History & Isolation)

```bash
# Launch independent Phase-4 file/test tasks together (once T010/T011 exist):
Task: "Extend src/history/HistoryStore.ts for the Conversation.messages shape"
Task: "Create src/history/ConversationSearch.ts"
Task: "Write failing tests/unit/store/conversationStore.test.ts and tests/contract/conversation-ownership.test.ts"
Task: "Write failing tests/integration/background-generation.test.ts"
```

## Parallel Example: User Story 1

```bash
# Launch all new chat component files together (no interdependency):
Task: "Create src/components/chat/MessageBubble.tsx"
Task: "Create src/components/chat/StreamingMessage.tsx"
Task: "Create src/components/chat/AssistantIdentityRow.tsx"
Task: "Create src/components/chat/ImagePromptCard.tsx"
```

---

## Implementation Strategy

### MVP First (through User Story 1)

1. Complete Phase 1: Setup.
2. Complete Phase 2: XState migration, verified behavior-preserving (its own checkpoint).
3. Complete Phase 3: Conversation/message generalization, verified behavior-preserving (its own checkpoint).
4. Complete Phase 4: Conversation ownership, drafts, History/search (its own checkpoint).
5. Complete Phase 5: User Story 1 (Unified Chat UI) — including the full `Answer` → `Chat` route migration.
6. **STOP and VALIDATE MANUALLY**: new text-only conversation, new image-first conversation, inline retry — on a physical device — before proceeding.

### Incremental Delivery

1. Setup → Regression Protection & XState → Conversation/Message Generalization → Conversation Ownership — each with its own regression-gate checkpoint, never combined.
2. Add US1 (Unified Chat UI) → validate manually → MVP.
3. Add US2 (Attachment Behavior) → validate manually (draft handling doesn't regress US1).
4. Add US3 (Mixed Multimodal Follow-Ups) → one automated regression + manual validation (doesn't regress US1/US2).
5. Add US4 (Drawer/History/Switching/Resume) → validate manually (doesn't regress US1–US3; ownership already proven in Phase 4).
6. Phase 9: full automated check + the comprehensive manual device-validation checklist + final regression gate.

### Why the foundation is split into three gated phases, not one

Research.md R11 explicitly sequences the XState swap (Phase 2) before the conversation/message generalization (Phase 3) before the conversation-ownership generalization (Phase 4) — each independently verified against the same regression suite (`vision-once-chat-flow.test.ts`) before the next begins. If any of the three were combined and a regression appeared, its cause would be ambiguous across the state-machine swap, the message-model change, and the ownership change simultaneously. Keeping them as separate, checkpoint-gated phases makes a regression's cause unambiguous.

### Why so few automated UI tests

Every automated test that survives in this plan protects logic that is genuinely hard to eyeball correctly on a device: state-machine transitions, context assembly and double-context prevention, arbitrary-position image-turn behavior, ownership/isolation invariants, single-flight, retry correctness, background-generation attribution, and pure search/derivation functions. Anything that reduces to "does this screen look and feel right, and does the obvious interaction work" is faster and more reliably checked by hand on the target physical device (Phase 9) than by maintaining brittle UI-integration tests in a repo with no component-render testing library installed (research.md R5).

---

## Notes

- [P] tasks = different files, no ordering dependency.
- [Story] label maps a task to its user story for traceability; Setup/Foundational/Polish tasks have none by design.
- Foundational Phases 2–4 must each reach a green regression-gate checkpoint before the next phase's tasks begin — this is the feature's core sequencing constraint, not a suggestion.
- `ExtractionPrompt.ts`, `AnswerPrompt.ts`, `SystemPrompt.ts`, `ExtractionParser.ts`, `AnswerPostProcessor.ts`, `GenerationLimits.ts`, `GenerationTuning.ts` are frozen for this entire feature (research.md R9) — no task in this file modifies them.
- There is no `turnIndex` field and no `Answer` route anywhere in this feature past Phase 5 — ownership/retry use stable message identity (`originatingUserMessageId`/`assistantMessageId`), and every navigation call site targets `Chat`.
- No onboarding or model-download UI work is in scope for this feature — `ModelSetupScreen.tsx`, `WelcomeScreen.tsx`'s onboarding content, and `onboardingStore.ts` are untouched except for `WelcomeScreen.tsx`'s single routing-target change in T031.
- Commit after each task or logical group.
- Avoid: vague tasks, same-file conflicts marked [P], cross-phase shortcuts that skip a regression-gate checkpoint, and re-adding automated UI tests this revision deliberately removed in favor of manual device validation.
