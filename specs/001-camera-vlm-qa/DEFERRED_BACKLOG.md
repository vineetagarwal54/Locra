# Deferred Backlog: Camera Vision Q&A (001-camera-vlm-qa)

This document consolidates every item that was specified for this feature but
is **intentionally not required** to close Phase 001. Nothing here was
dropped silently — each item preserves its original functional requirement
(FR) reference, its original task ID(s) in `tasks.md`, and the reasoning for
deferring it. Pick items up as standalone future work (most naturally as
their own feature spec) rather than folding them back into this one.

None of these block freezing `001-camera-vlm-qa` once the physical-device
validation gate (see `tasks.md`'s "Phase 11: Physical-Device Release
Validation Gate") is satisfied.

## 1. Text-only fallback model — FR-034

**Original task**: T060 (`tasks.md`, not started — depends on T064)

Offer a lightweight text-only model (e.g. Qwen 3 0.6B) on devices whose
`DeviceCompatibilityResult` indicates insufficient memory for the
vision-language model. **Why deferred**: this requires a second on-device
model's own download/verify/storage lifecycle layered onto the existing
single-model `modelStore`, plus a UI decision about how the app explains
"you're getting a different, more limited model." That is model-lifecycle
design work, not a small addition — better scoped as its own feature.

## 2. Multi-model selector — FR-038

**Original task**: T064 (`tasks.md`, not started)

Present a list of available on-device models with recommended status,
storage size, and minimum RAM requirement, letting the user choose which
single model is active. **Why deferred**: this is the prerequisite T060
depends on, and it changes the model-lifecycle contract from "exactly one
pinned model" to "one of several selectable models" — a real architectural
change to `IModelLifecycle` and `modelStore`, not a UI-only task.

**Explicit note**: multi-model selection and any additional/alternative
model downloads are intentionally out of scope for Phase 001's closure.

## 3. Flag with optional note (UI) — FR-035

**Original task**: T061 (`tasks.md`, not started)

**What's already done**: the backend fully supports this —
`historyStore.setFlag(id, flagged, note)` and
`inferenceStore.flagCurrentSession(note?)` both accept an optional note
(`data-model.md`'s `flagNote` field already exists on `QASession`).
**What's deferred**: the UI entry point — a text field shown when the user
taps "Flag answer" so they can actually supply a note, and displaying that
note next to the flagged indicator in `HistoryScreen.tsx`. Low priority
because the core flag action (FR-019) already works without it.

## 4. History search — FR-036

**Original task**: T062 (`tasks.md`, not started)

Filter the local Q&A history list by a case-insensitive substring match
against the question text as the user types, with no additional storage
reads. **Why deferred**: pure UI polish with no dependency on anything else
in this batch; picked up whenever history-browsing volume makes it useful.

## 5. Pinch-to-zoom on the captured image — FR-037

**Original task**: T063 (`tasks.md`, not started)

Bounded pinch-to-zoom on the answer screen's image thumbnail, resetting on
navigation away. **Why deferred**: pure UI polish, independent of every
other workstream; also needs a one-time confirmation that
`react-native-gesture-handler`'s `GestureHandlerRootView` is correctly
configured at the app root (unconfirmed as of this writing).

## 6. "Look again" re-extraction — FR-043

**Original task**: T075 (`tasks.md`, explicitly marked `[DEFERRED]`)

Re-run the structured-extraction step (FR-041) against a thread's original
stored image without starting a new thread — useful if the pinned extraction
missed something. **Why deferred**: per the Phase 3 Scope Note in `spec.md`,
this was specified so the requirement isn't forgotten, but no task in the
Phase 3 batch implements it. Pick up only once the vision-once/text-chat
split (FR-041/FR-042) has been validated stable on-device.

## 7. Rolling summarization beyond the sliding window — part of FR-044

**Original task**: T077 (`tasks.md`, explicitly marked `[DEFERRED]`)

Summarize turns older than the sliding-window floor instead of just relying
on the pinned extraction + last-K verbatim turns. **Why deferred**: build
this only once a real conversation is observed actually overflowing the
context window in practice — there is no evidence yet that the current floor
(pinned extraction + `SlidingWindowContextStrategy`) is insufficient. Building
it speculatively ahead of that evidence would be premature complexity.

## Not on this list (already fully implemented and tested)

For clarity, these related items are **not** deferred — they are code-complete
with automated test coverage and only await physical-device validation (see
`tasks.md`'s Phase 11 gate), which is a different kind of "pending" than the
items above:

- Multi-turn context fix, vision-once/text-chat, pinned context, resumable
  threads, clean-slate reset (T065–T101, all `[X]`)
- Copy/share answer actions (T055–T056, `[X]`)
- Voice dictation — **implemented in code and covered by automated tests**
  (`InferenceActivityLock`, `useVoiceTranscription`, `voiceStore`,
  `VoiceButton`; T057–T059, all `[X]`); only its on-device behavior
  (microphone capture, Whisper model download, transcription accuracy) is
  unvalidated on a physical device.
