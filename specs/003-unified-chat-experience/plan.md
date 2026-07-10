# Implementation Plan: Unified Chat Experience

**Branch**: `003-unified-chat-experience` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-unified-chat-experience/spec.md`

**Note**: The git branch `003-unified-chat-experience` has not been checked out yet (no branch-creation hook is configured; the working tree is currently on `002-output-quality-pipeline`). This plan assumes the branch will be created before implementation begins, per the user's confirmation at task time.

## Summary

Feature 003 unifies Locra's existing camera-first Q&A flow and a new text-first entry point into one **Conversation** concept: any user turn (first message or a later follow-up) may optionally carry one image, every image-bearing turn runs through the existing two-stage perception→answer pipeline, and every conversation is browsable/resumable through a new Conversation Drawer and a rebuilt Full History, all backed by the existing single MMKV-backed `HistoryStore`.

The central architectural change is **making the app's single-flight inference state conversation-attributed instead of a single global pointer**. Today, `inferenceStore.ts` tracks exactly one active thread via module-scoped `activeSessionId` / `lastSavedSession` / `activeTurn`, and `AnswerScreen` cancels in-flight generation on unmount. The corrected spec requires that navigating away from a generating conversation does **not** cancel it — the one app-wide in-flight generation (still exactly one at a time, per the constitution's Single-Flight Inference Queue principle) keeps streaming into its **originating conversation** in the background, other conversations remain browsable but read-only-for-sending until it frees up, and the user can only explicitly cancel it by returning to that conversation. This is achieved by keying the existing single-active-thread state by `conversationId` and having the engine-registration/subscription bridge attribute every streamed token to its owning conversation rather than to "whatever is currently on screen."

No parallel chat system, no parallel design system, and no second conversation-history mechanism are introduced: this feature generalizes the existing `QASession`/`HistoryStore`/`ContextBuilder`/`InferenceQueue` stack in place, and implements the already-approved New Chat, Active Chat, Image Preview, Image Answer, Conversation Drawer, and Full History screens from `design/design.md` using `theme.ts`-token-only shared components.

Per the spec's second revision pass, three points are load-bearing for this plan: (1) a conversation must support **any ordering** of text-only and image-bearing turns — text→text, image→text, text→image→text, and multiple image-bearing turns interleaved with text (spec FR-033) — not just "an image on any single turn"; (2) this feature MUST NOT regress the existing two-stage perception→answer processing, canonical conversation ownership, bounded context assembly, or double-context-injection prevention that Feature 001/002's camera-first flow already relies on (spec FR-034/SC-014) — it generalizes *when* that pipeline triggers, not the pipeline itself; (3) the turn/message model is described as "a turn that may carry multimodal content," with Feature 003's one-image-per-turn limit stated as a scoped functional constraint rather than a hardcoded ceiling, so a later feature can extend it (multiple images, audio) without redefining what a turn is (spec Key Entities, "Message").

**Terminology (used consistently across every planning artifact from here on)**: a **turn** is a behavioral/specification-level concept — a user interaction and the assistant response it produces (spec.md's FRs and Edge Cases use this word throughout). `ConversationMessage` is the persisted, domain-level entity data-model.md defines: one behavioral turn is realized as exactly two `ConversationMessage` records, a `role: 'user'` message immediately followed by a `role: 'assistant'` message, each with its own stable `id`. Every message belongs to exactly one `Conversation` and `Conversation.messages` is deterministically ordered. This is the single canonical conversation model for this feature — data-model.md, every file under `contracts/`, and `tasks.md` all use `Conversation.messages: ConversationMessage[]`; an earlier draft's `Conversation.turns: ConversationTurn[]` pair-array shape (`{question, imagePath, answer, status, errorMessage}` per turn) is superseded in full and must not reappear in any planning artifact.

**Architecture addition (this planning pass): XState v5 as a narrow orchestration layer.** `InferenceQueue.ts` (`src/inference/InferenceQueue.ts`) already implements a hand-rolled state machine — a mutable `status` union plus imperative `setState` calls — and two phases the redesigned UI needs to show distinctly (image perception/extraction, and prompt/context assembly) are currently invisible, buried inside the existing `'streaming'` status. `xstate` (core package only, zero dependencies, no native module — verified React-Native-compatible; see research.md R10, sources cited) replaces that internal control flow with a declarative state chart (`idle → preparing → perception → contextAssembly → generating → streaming → completed | failed | interrupted`, with `RETRY` looping back). This is internal to `InferenceQueue.ts` only: `IInferenceQueue`'s public contract, `ContextBuilder.ts`, every prompt/parsing module (R9's frozen list), Zustand as the sole UI-facing reactive layer, and app-wide single-flight are all unchanged. Migration is sequenced per research.md R11: protect the existing regression suite → swap in XState with behavior verified unchanged → *then* generalize per-turn image branching (R2) and conversation-attributed ownership (R1) → connect the redesigned UI → validate.

## Technical Context

**Language/Version**: TypeScript ~6.0.3, React Native 0.85.3 (New Architecture enabled), Expo ~56.0.15 managed workflow

**Primary Dependencies**: `react-native-executorch` ^0.9.2 (on-device VLM, `useLLM` hook), `zustand` ^5.0.14 (all app state — remains the sole UI-facing reactive layer), `xstate` ^5.x (**new** — internal turn/inference lifecycle orchestration only, inside `InferenceQueue.ts`; zero dependencies, no native module, no `@xstate/react`; research.md R10), `react-native-mmkv` ^4.3.2 (sole persistence, via `src/storage/mmkv.ts`), `@react-navigation/native` ^7 + `native-stack` ^7 (currently the only navigator — no drawer/tabs package installed yet), `react-native-vision-camera` ^5.1.0, `react-native-nitro-image` (image preprocessing), `expo-file-system`, `react-native-reanimated` 4.3.1 / `react-native-worklets` 0.8.3, `react-native-keyboard-controller` 1.21.6

**Storage**: `react-native-mmkv` only, extending the existing `history:*` key convention in `src/history/HistoryStore.ts` — no SQLite, no AsyncStorage (constitution Principle VIII)

**Testing**: Jest (`jest-expo` preset). The existing convention is pure logic/unit/contract tests against stores and pure functions, plus source-text structural assertions for screen wiring (no component-render testing library is installed — no RNTL). This feature continues that convention rather than introducing a new testing dependency (see research.md R5).

**Target Platform**: Android only (min API 26, target API 35); a physical device with 6GB+ RAM is required to validate camera capture, sustained multi-turn generation, and background-generation behavior — emulator results are not authoritative for these (existing constitution Technology Constraints).

**Project Type**: Mobile app — single Expo/React Native project, no separate backend, fully offline.

**Performance Goals**: Conversation switching and drawer/History browsing feel instant (matches `motion.md`'s 250–300 ms navigation tokens); exactly one inference in flight app-wide at any time, with no new concurrency target — background continuation changes *ownership/attribution*, not the single-flight guarantee itself.

**Constraints**: Zero network calls anywhere in the conversation/inference/navigation path; 512×512 image preprocessing ceiling preserved; the NDK is pinned to 26.3.11579264 — any new native dependency (e.g., a drawer package's `react-native-gesture-handler` peer dependency) must be checked against this pin before it is added (constitution Development Workflow).

**Scale/Scope**: 6 design-approved experiences touched (New Chat, Active Chat, Image Preview, Image Answer, Conversation Drawer, Full History); validation dataset of ~200 conversations / ~200 messages per conversation (spec SC-003/SC-010, a usability target, not a hard limit); single local user, no accounts.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|---|---|---|
| I | Privacy-First Architecture (NON-NEGOTIABLE) | PASS | No network calls introduced anywhere; drawer/History/switching/search are 100% local MMKV reads (FR-025). |
| II | Single-Flight Inference Queue (NON-NEGOTIABLE) | PASS — architecture change required | Exactly one inference in flight app-wide is preserved unchanged (`InferenceActivityLock`/`InferenceQueue` singletons stay singletons). What changes is *ownership attribution*: today's single global `activeSessionId`/`lastSavedSession`/`activeTurn` pointers must become conversation-keyed — and further keyed by stable `originatingUserMessageId`/`assistantMessageId` identities, never a positional turn index (data-model.md, research.md R1) — so a background generation stays bound to its originating conversation and message instead of whatever the UI currently shows (FR-014/015/016). This is additive scoping, not a relaxation of single-flight. |
| III | Graceful Degradation Over Crashes | PASS | FR-028/FR-029/FR-030 (inline failure, retry, four-state turns) extend this principle to per-turn generation failures; existing `ErrorBoundary` wrapping is preserved for all new/changed screens. Additionally, FR-034/SC-014 require zero regression to the existing camera-first flow's two-stage perception→answer processing, canonical conversation ownership, bounded context assembly, and double-context-injection prevention — enforced by keeping `ExtractionPrompt.ts`/`AnswerPrompt.ts`/`SystemPrompt.ts`/`ExtractionParser.ts` untouched and only generalizing the *trigger condition* in `ContextBuilder.ts`/`InferenceQueue.ts` (research.md R2/R9); `tests/integration/vision-once-chat-flow.test.ts` remains the regression anchor (extended, not replaced). |
| IV | Memory Safety on Constrained Hardware | PASS | 512×512 preprocessing ceiling untouched; per-turn image processing (now possible on any turn, not just turn 1, and repeatable across multiple image-bearing turns per FR-033) still runs the same bounded pipeline once per image-bearing turn, never concurrently (single-flight still holds). Virtualized list rendering is required for the ~200-conversation/~200-message validation target (research.md R6). |
| V | Minimal, Readable TypeScript | PASS | Generalizes existing types (`QASession` → `Conversation`, holding ordered `ConversationMessage[]` rather than a parallel entity model — data-model.md); no new abstraction beyond what conversation-keyed ownership and per-message image support require. Per spec's Message entity note, each `ConversationMessage.attachments: Attachment[]` is capped at one `kind: 'image'` entry per user message by validation only (FR-004), not by the type shape — future modalities (multiple images, a future `'audio'` kind) are not precluded, but nothing is built for them ahead of need. The new `xstate` dependency (research.md R10) is justified against this principle specifically because `InferenceQueue.ts` already *is* an ad hoc state machine today (a `status` union plus imperative `setState` calls with two states — perception, context assembly — currently invisible inside `'streaming'`); XState formalizes existing, already-present complexity into a declarative, testable form rather than introducing new complexity, and its scope is contractually narrow (contracts/turn-lifecycle-machine.md). |
| VI | TDD for Core Systems (NON-NEGOTIABLE) | PASS | Every changed/new function in `src/inference/` and `src/store/` (conversation-keyed ownership, per-turn image branching, draft handling, retry-in-place, and now the `turnLifecycleMachine`'s states/transitions) requires a failing test first, continuing the existing contract/unit-test and source-text-structural-assertion conventions. The XState swap specifically requires `tests/integration/vision-once-chat-flow.test.ts` to pass **unmodified** immediately after the swap (research.md R9/R11 step 2–3) before any further generalization work begins — this is the test-first regression gate for introducing the new dependency. |
| VII | New Architecture Only | PASS | `xstate` is a zero-dependency pure-JS/TS library with no native module and documented React Native production use (research.md R10, verified this session) — no New Architecture conflict. If a drawer navigation package is also added (research.md R3), that is a separate, still-open verification item. |
| VIII | Single Local Store | PASS | MMKV only, extending `HistoryStore`'s existing key convention — no second store for conversations/drafts. The `turnLifecycleMachine`'s XState `context` is explicitly non-persisted transient process state (data-model.md `TurnLifecycleSnapshot`), never a second store — contracts/turn-lifecycle-machine.md invariants 1–2 make this structurally testable, not just asserted. |
| IX | Verify Before Assuming | Satisfied for this session's additions | `xstate` v5's current API (`setup()`, `createMachine()`, `createActor()`, `fromPromise`, `fromCallback`, `.subscribe()`) was verified against current official Stately documentation during this planning session, not assumed from training data (research.md R10, sources cited). Any new `react-native-executorch` or navigation-library API assumption (e.g., a drawer package, research.md R3) still must be verified against the installed version's actual surface before use — flagged as a research.md action item, not assumed. |
| X | Hard Architecture Boundaries | PASS | Conversation-ownership/scoping logic stays in `src/inference/`/`src/store/`; new screens stay UI-only and reach the pipeline only through the existing hook/store surface; no screen imports inference internals directly. The conversation-keyed map structurally prevents the widened FR-021 leak categories (drafts, model request context, streaming output) from crossing conversations, since each is only ever reachable through its own map entry — there is no shared/global slot they could leak through. |
| XI | Design Source of Truth | PASS | FR-027 requires implementing all six touched experiences from `design/design.md` §7.8–7.14 and the approved `design/references/` screenshots already inspected for this plan; new shared chat/navigation components (`MessageBubble`, `ChatComposer`, `ConversationDrawer`, `HistoryCard`, etc. per `design.md` §8) must consume `theme.ts` tokens only — no hardcoded styles per screen, extracted from the inline styles `AnswerScreen.tsx`/`HistoryScreen.tsx` currently duplicate. `design.md`'s "Attachment Source Selection" (Camera/Gallery/Cancel) and §7.14's fourth `Older` History grouping — both added during this refinement pass — mean the two UI elements this feature needs beyond the original six-screen set are now sourced from the design folder rather than invented ad hoc by planning/task artifacts; no parallel visual system is introduced. |

All eleven principles PASS at this gate. Principle II is flagged as requiring a real architecture change (not a violation) — a conversation-keyed ownership model instead of a single global pointer — which research.md R1 designs in detail before Phase 1. No Complexity Tracking justification is needed: this is scoping/generalizing existing single-flight machinery, not adding a second inference path or relaxing the one-at-a-time guarantee.

**Post-Phase 1 re-check**: After completing research.md and data-model.md/contracts/quickstart.md, all eleven principles still PASS with no new violations:
- Principle II's design is now concrete (data-model.md's `ConversationRuntimeState`, contracts/inference-ownership.md's ownership/UI contract) and confirms the single-flight *lock* is never duplicated — `contracts/conversation-store.md` invariant 1 makes "at most one owner at a time" a test-verifiable property, not just a stated intent.
- Principle VIII holds: data-model.md reuses `IHistoryStore`'s existing method signatures and MMKV key ownership; no second store was introduced (`conversationStore` is in-memory/runtime-only per data-model.md, not a persistence layer).
- Principle IX's flagged items (R3's drawer-package NDK/New-Architecture verification) remain open **action items for Phase 2 task execution**, not unresolved gate failures — they are pre-adoption checks on a specific dependency, not an ambiguity in this feature's own requirements. `xstate` itself is fully verified and closed (R10).
- Principle XI holds: contracts/history-search.md and quickstart.md §3 both tie back to the same approved `design/` sources with no new visual system introduced — including the `Older` History grouping and the Camera/Gallery attachment source-selection pattern, both now defined in `design/design.md` rather than left for tasks.md to invent (research.md R13).
- Principles V/VI/VII/VIII's XState-specific notes are now concrete: contracts/turn-lifecycle-machine.md's six invariants make "narrow orchestration, no storage, no persistence, behavior-preserving swap" test-verifiable rather than a design intention.

**Post-refinement re-check** (this planning pass): the canonical data model was consolidated onto `Conversation.messages: ConversationMessage[]` (data-model.md), the `Answer` route was resolved to a single `Chat` destination with every existing call site enumerated (research.md R12), and Capture/attachment ownership was made explicit (research.md R13). None of these changes required a new Complexity Tracking entry: they are consistency corrections and a scoping decision (message identity is a smaller, more precise unit than the same conceptual data already held in the earlier turn-pair shape), not new architectural surface, new dependencies, or new principle trade-offs. All eleven principles remain PASS.

No Complexity Tracking entries are required post-design.

## Project Structure

### Documentation (this feature)

```text
specs/003-unified-chat-experience/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── conversation-store.md
│   ├── inference-ownership.md
│   ├── history-search.md
│   └── turn-lifecycle-machine.md
├── checklists/
│   └── requirements.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

This is a single Expo/React Native mobile project (no frontend/backend split, no separate API tier). The structure below extends the existing `src/`/`tests/` layout in place; no new top-level directories are introduced.

```text
src/
├── navigation/
│   ├── AppNavigator.tsx           # extended: adds Conversation Drawer as a wrapping navigator;
│   │                               #   RootStackParamList.Answer renamed to Chat: { conversationId: string }
│   │                               #   ('new' sentinel for an as-yet-uncreated draft) — Answer no longer
│   │                               #   exists as a route, resolving the one-unified-destination decision
│   │                               #   (research.md R12); resolveInitialRoute() points at Chat, not Capture
│   └── ConversationDrawer.tsx     # new: drawer content (recent list, New chat, View all history, Settings);
│                                   #   navigates to Chat only, never Answer
├── screens/
│   ├── ChatScreen.tsx             # new: generalizes AnswerScreen into the single conversation-scoped
│   │                               #   screen covering New Chat / Active Chat / Image Preview / Image
│   │                               #   Answer states (design.md §7.8/7.9/7.11/7.12/7.13) — replaces
│   │                               #   AnswerScreen as the app's landing/chat destination, rendered by
│   │                               #   the Chat route (research.md R12)
│   ├── HistoryScreen.tsx          # rebuilt: grouped Today/Yesterday/Previous 7 Days/Older (design.md
│   │                               #   §7.14, updated this pass) + local search, using ConversationList's
│   │                               #   search/preview; navigates to Chat (research.md R12), not Answer;
│   │                               #   all four groups populated from IHistoryStore.list() — no
│   │                               #   conversation becomes unreachable past 7 days (data-model.md)
│   ├── CaptureScreen.tsx          # retained but narrowed: camera-viewfinder-only, reached from
│   │                               #   ChatComposer's attachment control; requires a conversationId route
│   │                               #   param ('new' or an existing id) and writes the captured path
│   │                               #   directly into that conversation's draft — never an ambient
│   │                               #   "current conversation" (research.md R13); no longer submits a
│   │                               #   question itself and no longer the landing route
│   ├── WelcomeScreen.tsx          # unchanged (routes into Chat with conversationId: 'new' instead of
│   │                               #   Capture once ready — research.md R12)
│   └── ModelSetupScreen.tsx       # unchanged
├── components/
│   ├── chat/                      # new shared primitives (design.md §8 "Chat" component list)
│   │   ├── ChatComposer.tsx       #   text + attachment + mic + send, all composer states (§9);
│   │   │                          #   presents Camera/Gallery/Cancel (design.md "Attachment Source
│   │   │                          #   Selection") — Gallery picks inline with no navigation, Camera
│   │   │                          #   navigates to CaptureScreen with this screen's own conversationId
│   │   │                          #   (research.md R13)
│   │   ├── MessageBubble.tsx      #   UserMessage/AssistantMessage, theme-token only
│   │   ├── ImagePromptCard.tsx    #   attached/sent image + question card
│   │   ├── StreamingMessage.tsx   #   generating/streaming state, three-dot indicator (motion.md §11.3)
│   │   └── AssistantIdentityRow.tsx
│   ├── ConversationListItem.tsx   # new: shared row for drawer + History (design.md §8 "Cards and rows")
│   └── ...                        # existing AnswerActions, ErrorBoundary, OfflineIndicator reused as-is
├── store/
│   ├── conversationStore.ts       # new: conversation-keyed ownership (generalizes inferenceStore's
│   │                               #   single activeSessionId/lastSavedSession/activeTurn pointers into
│   │                               #   a per-conversation map keyed by conversationId, further attributed
│   │                               #   by stable originatingUserMessageId/assistantMessageId identities,
│   │                               #   never a positional turn index; still backs onto the one
│   │                               #   InferenceQueue singleton — see research.md R1) + draft state
│   │                               #   (FR-031/032); retryFailedMessage(conversationId, assistantMessageId)
│   ├── inferenceStore.ts          # extended: submit() takes an explicit conversationId plus the
│   │                               #   originating user message; subscription bridge attributes streamed
│   │                               #   state to conversationStore's map entry (keyed by conversationId +
│   │                               #   assistantMessageId) instead of a single global slot
│   └── ...                        # mediaStore, modelStore unchanged
├── inference/
│   ├── turnLifecycleMachine.ts    # new: xstate v5 setup()/createMachine() — idle/preparing/perception/
│   │                               #   contextAssembly/generating/streaming/completed/failed/interrupted
│   │                               #   (research.md R10, contracts/turn-lifecycle-machine.md); context
│   │                               #   carries requestId/conversationId/originatingUserMessageId/
│   │                               #   assistantMessageId — no turnIndex. Introduced FIRST (research.md
│   │                               #   R11 step 2), verified behavior-preserving (step 3), BEFORE the
│   │                               #   per-message image branching below (step 4).
│   ├── ContextBuilder.ts          # extended: per-message image branching — any ConversationMessage with
│   │                               #   a non-empty attachments runs the two-stage perception→answer path
│   │                               #   (not only the first message); text-only messages keep the existing
│   │                               #   canonical-messages path unchanged (research.md R2). Called from
│   │                               #   turnLifecycleMachine's contextAssembly-state actor, unmodified
│   │                               #   itself (research.md R9); double-context-injection prevention is
│   │                               #   unchanged and preserved.
│   ├── InferenceQueue.ts          # extended: internals reimplemented atop turnLifecycleMachine (research.md
│   │                               #   R10) — IInferenceQueue's public submit/cancel/subscribe/getState
│   │                               #   contract is UNCHANGED; `isFollowUp`/"first turn" framing generalizes
│   │                               #   to "does this specific message carry an image", independent of
│   │                               #   position, keyed by assistantMessageId rather than a turn index
│   └── ...                        # ExtractionPrompt/Parser, AnswerPrompt, InferenceTrace unchanged
│                                   #   (research.md R9's frozen list — called from machine actors as-is)
├── history/
│   └── HistoryStore.ts            # extended: Conversation entity now holds messages: ConversationMessage[]
│   │                               #   (ordered, role-tagged, stable id per message — data-model.md's
│   │                               #   canonical model; supersedes the earlier turns[]/ConversationTurn
│   │                               #   pair shape everywhere), updatedAt, same MMKV key convention, same
│   │                               #   CRUD contract shape; adds title/preview derivation + local text
│   │                               #   search; list(limit?, offset?) — already-existing signature, explicitly
│   │                               #   documented in contracts/conversation-store.md — is what both the
│   │                               #   drawer's recent subset and HistoryScreen's four recency groups
│   │                               #   (including Older) rely on; no other pagination API is introduced
│   └── ConversationSearch.ts      # new: pure function, local title/user-visible-text filter (FR-024)
└── constants/theme.ts             # unchanged — consumed, not modified

tests/
├── contract/
│   ├── history-store.test.ts       # extended for Conversation.messages shape + structural boundary
│   │                                #   re-asserted + list(limit, offset) slicing correctness across a
│   │                                #   set larger than one page
│   ├── conversation-ownership.test.ts   # new: app-wide single-flight + per-conversation attribution,
│   │                                     #   keyed by conversationId + assistantMessageId
│   └── turn-lifecycle-machine.test.ts   # new: contracts/turn-lifecycle-machine.md's invariants, framed
│                                         #   behaviorally (valid transitions, single-flight, retry-reuses-
│                                         #   identity) rather than pinned to internal structure — written
│                                         #   FIRST, must fail before turnLifecycleMachine.ts exists, and
│                                         #   vision-once-chat-flow.test.ts must still pass unmodified once
│                                         #   this lands (research.md R9/R11 steps 2-3)
├── integration/
│   ├── unified-chat-flow.test.ts        # new: text-first + image-first entry, any-position image, follow-ups
│   ├── background-generation.test.ts    # new: switch away mid-stream, output stays bound to origin
│   │                                     #   conversation + assistantMessageId, other conversations
│   │                                     #   send-blocked, resume shows correct state
│   └── vision-once-chat-flow.test.ts     # extended, not replaced — its PRE-EXISTING assertions must pass
│                                          #   unmodified both immediately after the XState swap (regression
│                                          #   gate) and after the any-position-image generalization (subset case)
└── unit/
    ├── inference/ContextBuilder.test.ts  # extended: per-message image branching + double-context-
    │                                      #   injection-prevention cases
    ├── store/conversationStore.test.ts   # new: conversation-keyed map, draft preservation,
    │                                      #   retryFailedMessage identity (no duplicate messages)
    └── history/ConversationSearch.test.ts # new
```

**Structure Decision**: Single Expo/React Native project (no Option 2/3 web or API split applies). Feature 003 is implemented entirely by generalizing existing modules in their current locations (`src/store/`, `src/inference/`, `src/history/`, `src/screens/`, `src/navigation/`) plus one new store (`conversationStore.ts`), one new internal orchestration module (`src/inference/turnLifecycleMachine.ts`, `xstate`-backed, research.md R10), and one new component directory (`src/components/chat/`) for the design system's Chat primitives that don't exist yet. No new top-level directory, no parallel chat/history/store stack, and no parallel inference pipeline — `turnLifecycleMachine.ts` is a controller for the existing pipeline's control flow, not a second pipeline.

## Complexity Tracking

*No Constitution Check violations require justification.* Principle II's ownership-attribution change (single global pointer → conversation-keyed map) is a scoping generalization of existing single-flight machinery, not a new architectural layer, a second inference path, or a relaxation of the one-at-a-time guarantee — it does not meet the bar for a Complexity Tracking entry.

The `xstate` dependency (research.md R10) is likewise not a Complexity Tracking entry: it formalizes control flow (`InferenceQueue.ts`'s existing `status`/`setState` pattern) that already exists today, is contractually scoped to internal orchestration only (contracts/turn-lifecycle-machine.md), was verified against current documentation rather than assumed (Principle IX), and carries no native/NDK risk (Principle VII). A justification would be needed if XState were being used for conversation storage, cross-cutting UI state, or persistence — the task brief explicitly ruled all three out, and the contract's invariants make that structurally enforced, not just a stated intention.
