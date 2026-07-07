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
- The dev build installed per the project's `README.md` "Getting started"
  section (`npx expo run:android` then `npx expo start --dev-client`).
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

## Scenario 3 — Missing/corrupt model (SC-003, User Story 2)

1. On a compatible device with no model downloaded, launch the app.
   **Expected**: routed to the download screen automatically.
2. Start the download, then background the app (or toggle airplane mode
   on/off) partway through. **Expected**: on return, the download resumes
   from where it left off rather than restarting (FR-014).
3. After a successful download, manually corrupt the downloaded `.pte`
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

## Scenario 10 — Output quality tuning (T095, FR-050–FR-054)

1. Run several asks across varied subjects (text-heavy label, cluttered
   scene, single object).
2. **Expected** vs. the pre-Phase-3 baseline: answers are concise (typically
   1–3 sentences), grounded in visible content only (no invented brands or
   speculation), and do not ramble or repeat.
3. Ask something that invites a long answer ("Describe everything you see in
   detail"). **Expected**: the answer stops near the output budget with the
   visible "length limit" notice rather than degenerating into repetition.
4. If any answer ends mid-sentence or repeats a phrase, **Expected**: the
   distinct "May be cut off" / repetition notice appears under it (and on its
   History entry) rather than it being presented as a normal complete answer.
