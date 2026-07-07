# Quickstart: Validating Camera Vision Q&A (Phase 1)

This is a manual validation guide proving the feature works end-to-end. It
maps directly to the spec's Success Criteria (`spec.md`) — run every
scenario on a **physical Android device** (constitution: emulators do not
reflect real inference latency or memory pressure).

## Prerequisites

- A physical Android device meeting the compatibility gate determined by
  this plan (Android 13+, 6GB+ RAM — see `research.md` Flagged Risk 2 for
  why this differs from the project's original API 26 claim).
- A second, older/lower-RAM Android device (or an emulator profile
  reporting <6GB RAM) to exercise the unsupported-device path.
- **A current EAS-built dev-client APK installed on the device.** Per
  `plan.md`'s Build Strategy and `research.md`'s Phase 1 Setup Findings,
  this project has **no working local Android build path** on the
  development machine — the `react-native-executorch` prebuilt native libs
  need NDK 26 while React Native's own Fabric headers and the
  reanimated/worklets pair need NDK 27, and no single NDK satisfies both.
  `npx expo run:android` / local `gradlew assembleDebug` are **not** a valid
  build-verification step for this project; do not use them. Build via
  `eas build --platform android --profile development` (or whichever
  profile is current), install the resulting APK on the device, then run
  `npx expo start --dev-client --clear` for Metro/JS iteration (`adb reverse
  tcp:8081 tcp:8081` if connecting over USB). Rebuild via EAS whenever a
  native dependency changes (this Phase 3 batch added `expo-audio` and
  `expo-image-manipulator` — both need a fresh EAS build before any
  scenario below that exercises voice or image enhancement).
- Nothing else pre-configured — first launch should have no model present.

## Scenario 1 — Core ask loop in airplane mode (SC-001, User Story 1)

1. Launch the app on the compatible device with the model already
   downloaded and verified (see Scenario 3 first if starting fresh).
2. Enable Airplane Mode on the device.
3. Point the camera at a real object, capture, type a question about it,
   submit.
4. **Expected**: The answer streams in token-by-token; once complete, all
   five metrics (model load time, image preprocessing time, first-token
   latency, tokens/sec, total wall time) are displayed. No permission
   prompt or error related to connectivity appears at any point.
5. While the answer is still streaming, attempt to submit a second question.
   **Expected**: the submission is blocked/ignored until the first
   completes or is cancelled (FR-006).
6. Cancel a subsequent in-progress inference. **Expected**: streaming stops
   immediately, no entry for it appears in history (Scenario 4), and a new
   submission is immediately possible.

## Scenario 2 — Unsupported device (SC-002, User Story 2)

1. Launch the app on the lower-RAM device/profile.
2. **Expected**: the setup screen appears explaining the device does not
   meet requirements (naming the actual reason — RAM or OS version). The
   app does not crash, hang, or show a blank screen.

## Scenario 3 — Missing/corrupt model, background download, and notification behavior (SC-003, User Story 2, FR-014, FR-025)

1. On a compatible device with no model downloaded, launch the app.
   **Expected**: routed to the download screen automatically.
2. Start the download. **Expected**: a persistent Android notification
   appears showing download percentage and megabytes downloaded, updating
   as the download progresses (FR-025).
3. Tap the pause control (in-app), then resume. **Expected**: the download
   pauses and resumes correctly with no error. Repeat using the
   notification's own pause/resume actions. **Expected**: identical
   behavior — pause/resume works from both surfaces.
4. Background the app partway through the download (press Home).
   **Expected**: the download continues in the background; the
   notification keeps updating.
5. Tap the download notification while the app is backgrounded.
   **Expected**: the app returns to the foreground on the
   `ModelSetupScreen`, showing current progress (FR-025).
6. Force-kill the app process entirely (not just backgrounding — e.g. via
   Android's recent-apps swipe-away or `adb shell am force-stop`) partway
   through a download, then relaunch the app. **Expected**: the download is
   reattached and resumes from where it left off rather than restarting
   from zero (FR-014) — this is a stronger test than simple backgrounding,
   since it exercises `reattachExistingDownload()`'s process-death recovery
   path specifically.
7. After a successful download, manually corrupt the downloaded `.pte`
   file's bytes (e.g. via `adb shell`), then relaunch the app.
   **Expected**: the app detects the failed integrity check and returns to
   the download screen rather than attempting to load the model or
   crashing (FR-012/FR-013).

## Scenario 4 — History management (User Story 3)

1. Complete 3–4 ask flows from Scenario 1.
2. Open the History screen. **Expected**: all completed sessions are
   listed with their question, answer, and metrics; the cancelled session
   from Scenario 1 step 6 does not appear.
3. Delete one entry. **Expected**: it disappears immediately and does not
   return after an app restart.
4. Clear all history. **Expected**: an empty state is shown, not an error.

## Scenario 5 — Report a bad answer (User Story 4)

1. From the answer screen after a completed inference, trigger the report
   action. **Expected**: the session is marked flagged without navigating
   away from the current screen, and no network request is made (verify via
   the device's network activity indicator or airplane mode still being on
   from Scenario 1).
2. Open History. **Expected**: the flagged session is visibly marked.

## Scenario 6 — Benchmark screen (User Story 5)

1. With the sessions from Scenario 4 present, open the Benchmark screen.
   **Expected**: all five metrics are visualized/summarized across the
   recorded sessions.
2. Clear all history (Scenario 4 step 4), then reopen the Benchmark screen.
   **Expected**: an empty, informational state — not an error.

## Scenario 7 — Sustained-use crash check (SC-008)

1. Perform 50 consecutive ask attempts (mix of completed, cancelled, and if
   reproducible, a forced low-memory condition via Android's developer
   options).
2. **Expected**: every attempt ends in a delivered answer or a graceful,
   explained error state. Zero application crashes across the run.

## Scenario 8 — Multi-turn context on-device (T068, FR-039/FR-040)

1. Capture a photo of a distinctive object and ask "What is this?" Wait for
   the structured answer to complete.
2. Ask at least three follow-ups that only make sense with turn 1's context
   (e.g. "What color is it?", "Is it damaged?", "How would you clean it?").
3. **Expected**: every follow-up answers about the SAME object from turn 1 —
   no "what object do you mean?" responses, no context resets, and each
   follow-up is visibly text-only (near-instant preprocessing, no camera
   re-read).

## Scenario 9 — Resumable threads and clean-slate reset (T083, FR-045–FR-048)

1. Complete a thread: capture → question → two follow-ups. Note the object.
2. Tap back to the camera, then open History. **Expected**: the thread
   appears as ONE entry containing all three turns.
3. Tap the entry (or its Continue button). **Expected**: the full thread
   reopens with every turn visible, and the composer accepts another
   follow-up that answers in-context of the original photo.
4. Back out to the camera and capture a DIFFERENT object; ask "What is
   this?" **Expected**: the answer describes only the new object — zero
   references to the previous thread's object (clean-slate check, FR-047).
5. While an answer is streaming, navigate back to the camera.
   **Expected**: generation stops (no background battery/CPU burn), the app
   stays responsive, and no partial answer is saved to history.
6. Kill the app entirely, relaunch, open History, and reopen the thread from
   step 1. **Expected**: it hydrates in full and accepts a further follow-up
   without hanging (fresh-process resume path).

## Scenario 10 — Answer quality (T095, FR-041, FR-050–FR-054)

**Historical note**: this scenario originally required every answer to be
1–3 sentences and to use *only* visible image information. That criteria
was superseded by the FR-050 fix (see `spec.md`'s correction note and
`tasks.md` T098–T101): the persistent assistant is now deliberately bold and
expansive, drawing on general knowledge whenever a question calls for it,
and answer length is no longer capped to a sentence count — only to the
`OUTPUT_TOKEN_BUDGET` token ceiling. The criteria below reflect that current,
intended behavior; do not fail a run for being "too long" or "using
knowledge beyond the photo" if the question warranted it.

1. Capture a photo and ask the first, image-attached question ("What is
   this?"). **Expected**: the turn-1 answer accurately describes what is
   actually visible (subject, features, visible text, condition) and does
   not invent details that are not in the photo (FR-041, FR-053).
2. Ask 2–3 follow-ups that build on turn 1 (e.g. "Is it damaged?", "What
   color is the handle?"). **Expected**: each follow-up correctly uses the
   image/conversation context from earlier turns — it does not lose track
   of what was being discussed.
3. Ask a benign follow-up that goes beyond the photo (e.g., given a photo of
   a pan, ask "It's a bit sticky, how do I fix that?"). **Expected**: the
   assistant answers helpfully using general knowledge — it does **not**
   refuse or deflect with scope-shaped language ("I can only help with
   images," "my primary function is visual content," etc.). This is the
   specific regression `tests/contract/prompt-assembly.test.ts` guards
   against in code; this step confirms it holds on-device too.
4. Ask something that invites a long, detailed answer ("Describe everything
   you see in detail," or a multi-part question). **Expected**: the response
   detail is appropriate to the question — a longer, more thorough answer is
   fine here, and is not itself a defect. If the answer reaches the output
   budget, it stops with the visible "length limit" notice rather than
   degenerating into repetition.
5. Across all the above, **Expected**: no answer repeats itself in an
   obvious loop, cuts off abruptly mid-sentence, or rambles irrelevantly past
   what the question asked for. If an answer's tail is detected as truncated
   or looping, the distinct "May be cut off" / repetition notice appears
   under it (and on its History entry) rather than being presented as a
   normal complete answer.

## Scenario 11 — Voice dictation (T057–T059, FR-033)

Requires a fresh EAS dev-client build (adds the `expo-audio` native module and
`RECORD_AUDIO` permission).

1. Capture or pick a photo so the question field appears. Press and hold the
   mic button for the first time. **Expected**: it does not record yet; a
   "Preparing voice… N%" status shows while the Whisper model downloads (only
   on first-ever use; not downloaded for users who never tap the mic).
2. Once ready, press and hold the mic and speak a question, then release.
   **Expected**: a "Listening…" then "Transcribing…" status; the recognized
   text is appended to the question field and the input is NOT auto-submitted —
   the user can edit it before tapping Ask.
3. Deny the microphone permission when prompted. **Expected**: a clear inline
   error, no crash, and the typed-input path still works.
4. Start a VLM inference (tap Ask), then try to hold the mic while it is
   answering. **Expected**: the mic is disabled (mutual exclusion) — voice and
   inference never run at the same time. Symmetrically, holding the mic to
   record blocks a new Ask until recording finishes.
5. Confirm the whole flow runs with the device in airplane mode after the
   one-time model download — transcription is fully on-device.

## Scenario 12 — Storage behavior during normal use (Phase 11 validation gate item 15)

1. Note the device's free storage before starting, then perform a normal
   session: several captures, a few multi-turn threads (with image
   enhancement running on each capture), and a handful of history
   deletions.
2. **Expected**: free storage does not shrink unboundedly — temporary/
   intermediate files from image enhancement (`ImageEnhancer.ts`'s
   orientation-bake and resize passes) and preprocessing do not accumulate
   indefinitely; deleting a history entry does not leave its image file
   behind consuming space.
3. Confirm the on-device model file itself remains a single ~1.2GB asset
   (no duplicate/partial copies left over from a prior interrupted download
   per Scenario 3).
