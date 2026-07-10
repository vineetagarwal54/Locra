# Quickstart: Validating the Unified Chat Experience

This is a validation/run guide, not an implementation guide. It assumes Phase 2 tasks have been implemented against `data-model.md` and `contracts/*`. For field/interface details, see those files rather than duplicating them here.

## Prerequisites

- Node/Expo toolchain already set up for this repo (see `AGENTS.md`'s Build strategy section).
- A build with the model already downloaded and verified (`ModelSetupScreen` complete) — this feature does not touch model download/lifecycle.
- **A physical Android device with 6GB+ RAM**, connected via `adb reverse tcp:8081 tcp:8081` and `npx expo start --dev-client --clear`. Per the constitution's Technology Constraints, emulator results are not authoritative for camera capture, sustained multi-turn memory/perf behavior, or background-generation timing — the scenarios below marked **(device-required)** must be run on real hardware before this feature is considered validated.

## 1. Automated checks (run first, on any machine)

```powershell
npx tsc --noEmit
npx eslint src tests --ext .ts,.tsx
npm test
```

All contract/unit/integration tests listed in `plan.md`'s Project Structure (`tests/contract/conversation-ownership.test.ts`, `tests/contract/turn-lifecycle-machine.test.ts`, `tests/integration/unified-chat-flow.test.ts`, `tests/integration/background-generation.test.ts`, `tests/unit/store/conversationStore.test.ts`, `tests/unit/history/ConversationSearch.test.ts`, plus the extended existing suites) must pass. These encode the contracts in `contracts/*.md` — a failing test here means a contract violation, not a flaky test to retry.

**Regression gate (FR-034/SC-014)**: `tests/integration/vision-once-chat-flow.test.ts`'s pre-existing turn-1-image assertions must pass **unmodified**. If this step requires editing any of that file's original assertions (not just adding new any-turn/multi-image ones alongside them), treat it as a regression in the existing camera-first flow, not a spec update to reconcile — stop and investigate before proceeding, per research.md R9.

**XState introduction gate (research.md R10/R11 steps 2–3)**: this regression gate must be run and pass **twice**, independently: once immediately after `turnLifecycleMachine.ts` replaces `InferenceQueue.ts`'s internal control flow (before any per-turn image or multi-conversation work begins — confirms the state-machine swap alone changed nothing observable), and again after the any-turn-image generalization (R2) lands. If the first run is red, the cause is isolated to the XState swap; do not proceed to generalize the turn model until it is green.

## 2. Manual/device validation scenarios

Each scenario references the spec's User Story / FR it validates.

### 2.1 Unified entry (US1, FR-001–FR-005) **(device-required for camera)**
1. Fresh launch → land on New Chat (empty state, no prior content).
2. Send a text-only question → streamed answer appears; conversation now exists in the drawer/History.
3. Start a second new conversation → attach a photo via camera capture → ask a question → streamed answer appears referencing the image.
4. Confirm both conversations look and behave identically in navigation (same drawer/History treatment).

### 2.2 Image on any turn, any ordering (US2, US3, FR-003/FR-009/FR-010/FR-011/FR-033)
1. In an existing text-only conversation (from 2.1), attach an image to a follow-up message and send it → answer references the image; prior turns are unchanged. (text→image)
2. Ask a further text-only follow-up referring back to that image ("what color was it?") → answered correctly without re-attaching. (text→image→text)
3. In the same conversation, attach a second, different image on a later follow-up and ask about it → answered correctly, and a further text-only follow-up can still distinguish between the two images' content when asked ("which one was outdoors?"). (imageA→text→imageB→text)
4. Separately, confirm a conversation that starts with an image (image→text, from 2.1) and one that never gets an image (text→text) both behave identically in every other respect (streaming, retry, drawer/History listing).
5. Attach and remove an image before sending, both as a conversation's first message and as a mid-conversation follow-up → in both cases, typed text and the conversation remain intact, and no image-derived entry is created if nothing was ever sent.

### 2.3 Drafts across navigation (US2 scenario 4, FR-031/FR-032)
1. Type text (and/or attach an image) in conversation A without sending.
2. Switch to conversation B via the drawer, then to History, then back to A.
3. Confirm A's draft (text + image) is exactly as left.
4. Repeat starting from a brand-new, never-sent New Chat draft → switch away and back → confirm the draft is preserved and still no drawer/History entry exists for it.

### 2.4 Background generation & app-wide single-flight **(device-required — timing-sensitive)**
1. In conversation A, send a question that will take several seconds to answer.
2. While it streams, open the drawer and switch to conversation B.
3. Attempt to send a message in B → confirm it is blocked with an indication that generation is in progress elsewhere, and B's draft is preserved (not lost).
4. Open conversation A again while still generating → confirm the live streaming state is visible (not "stopped").
5. Let it finish while viewing a different conversation (B or the drawer) → return to A → confirm the completed answer is present and correctly attributed, with no leakage into B.
6. Repeat, but this time explicitly cancel from within A while it streams → confirm the turn shows as `interrupted`, distinct from a normal `failed` state, and that a new `submit()` from any conversation now succeeds immediately.

### 2.5 Failure & retry (US1 scenario 5, FR-028/FR-029/FR-030)
1. Force a generation failure (e.g., temporarily simulate an engine error in a dev build, or use existing failure-injection test hooks).
2. Confirm the failed turn is visible inline with a failure indicator and a retry action.
3. Retry → confirm the same turn regenerates (no duplicate user message, no extra assistant turn) and ends in `completed` or `failed` again.

### 2.6 Drawer, History, isolation (US4, FR-017–FR-021, FR-023–FR-025)
1. Create 3+ conversations with distinguishable content.
2. Switch between all of them via the drawer; confirm each shows only its own messages.
3. Open Full History; confirm all conversations are listed, grouped by recency, with correct titles (including a fallback title for any image-only-first-message conversation) and previews.
4. Search History for a word that appears only in one conversation's text → confirm only that conversation is returned, and that searching never surfaces anything from a different conversation.
5. Turn on airplane mode → repeat steps 2–4 → confirm identical behavior (FR-025).
6. With zero conversations (fresh install or cleared data) → open History → confirm the empty state (FR-026), not an error.

### 2.7 Scale validation dataset **(device-required)**
Per research.md R6/R7 and spec SC-003/SC-010, this is a validation target, not a hard limit — the pass criteria are observable outcomes, not a subjective "feels smooth" judgment:
1. Seed ~200 stored conversations (via a test-data script or repeated scripted sends — implementation detail left to Phase 2 tooling).
2. Browse the drawer and Full History: confirm no crash, correct isolation when opening any of them, and usable scrolling/navigation on the physical device.
3. Within one conversation, accumulate ~200 messages (mix of text and image-bearing turns): confirm no crash, no dropped/duplicated/reordered messages on resume and scroll.

## 3. Design conformance spot-check

Compare the running app against the approved references for each touched screen (`design/references/*.png`, mapped via `design/screen_map.md`):

- New Chat, Active Chat (Generating), Image Preview, Image Answer, Conversation Drawer, Full History.
- Confirm: `theme.ts` tokens only (no ad hoc colors visible), no unread badges anywhere in the drawer/History (explicit design guardrail), no internal prompt-stage names or raw model identifiers surfaced anywhere, motion durations feel consistent with `motion.md` §4 (100–300 ms for most interactions).

## 4. Sign-off criteria

This feature is validated when: all automated checks pass including the regression gate (§1), all manual scenarios in §2 pass on a physical device where marked, and the design conformance spot-check (§3) finds no deviation from the approved sources.
