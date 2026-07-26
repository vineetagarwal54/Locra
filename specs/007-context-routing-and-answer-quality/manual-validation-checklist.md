# Spec 007 manual validation checklist

This worksheet covers the physical-device work intentionally left unchecked in
`tasks.md`. Record the device, Android version, build identifier, model artifact,
and date before starting. For each item, capture the visible result and the
diagnostics export where applicable. Do not mark the corresponding task complete
until every required result has been observed on hardware.

## Native stop behavior (T034)

- [ ] Start a response long enough to stream for several seconds.
- [ ] Cancel it during streaming.
- [ ] Confirm the linked `llama.rn` `stopCompletion()` call stops generation.
- [ ] Confirm already-streamed text remains visible and persisted.
- [ ] Confirm the inference queue releases and the next request runs normally.
- [ ] Record the device result before changing or approving any stopping threshold.

## Routing and image continuity (MV-001–MV-010, MV-012)

- [ ] **MV-001:** Ask a standalone factual question inside a chat containing
  unrelated turns, facts, a summary, and an image. Confirm diagnostics select no
  unrelated context.
- [ ] **MV-002:** Ask genuine dependent follow-ups such as “What about that?” and
  confirm only the turns needed to resolve the reference are selected.
- [ ] **MV-003:** In a summarized long chat, recover a relevant earlier fact, then
  ask an unrelated standalone question and confirm the old topic is absent.
- [ ] **MV-004:** Attach a new image, ask about it, and confirm visual evidence is
  recorded and the image becomes active.
- [ ] **MV-005:** Ask a non-pixel-dependent follow-up about the active image and
  confirm stored evidence is reused; then ask a non-visual question and confirm no
  image evidence is attached.
- [ ] **MV-006:** Ask OCR, count, and price questions about the active image.
  Confirm each required fresh vision inference uses the original local image and
  evidence remains linked to that image without duplicate active retrieval noise.
- [ ] **MV-007:** With at least two images, reference an older image by ordinal and
  by a unique description. Confirm the intended older image is selected.
- [ ] **MV-008:** With two plausible images, then with three plausible images, use
  a generic reference. Confirm ambiguity is recorded, no older image is guessed,
  and any active-image fallback is explicitly shown in diagnostics.
- [ ] **MV-009:** Remove an original image file. Confirm a pixel-dependent question
  reports `original-unavailable`, while a non-pixel question may reuse sufficient
  stored evidence.
- [ ] **MV-010:** Immediately after an image turn, ask an unrelated standalone
  question and confirm image evidence is neither queried nor selected.
- [ ] **MV-012:** Submit identical text once by typing and once through voice
  transcription. Confirm classification and context diagnostics match.

## Generation, retrieval, and persistence (MV-011, MV-013–MV-016)

- [ ] **MV-011:** Exercise a loop-prone prompt, a short factual request, and a
  genuinely detailed request. Confirm early loop stopping, concise short answers,
  and sufficient detail respectively.
- [ ] **MV-013:** The production embedding artifact is still separately gated.
  Until it is approved, confirm lexical fallback works and no semantic-runtime
  claim is made. After separate approval, verify fused exact-plus-semantic
  retrieval and failure/stale/backfill lexical fallback.
- [ ] **MV-014:** Confirm cross-chat memory is off by default. Enable it and verify
  attributed local retrieval; exclude a conversation and confirm bilateral
  isolation; disable the global setting and confirm the very next turn is
  same-chat-only.
- [ ] **MV-015:** Cancel and restart the app. Confirm partial text behavior, the
  cross-chat setting, per-chat exclusions, and deterministic routing survive as
  specified.
- [ ] **MV-016:** Exercise Low, Medium, and High response modes near the model
  context limit. Confirm diagnostics' used/maximum token units agree with the
  final prompt and protected current-turn/referenced-image evidence is retained.

## Grounding diagnostics (optional Phase 8)

- [ ] Ask one answerable and one deliberately unsupported image/retrieval question.
  Confirm `supported`/`unsupported` appears only in developer diagnostics and does
  not alter the visible response.

## Offline and regression validation (MV-017–MV-018)

- [ ] **MV-017 / T053:** Enable airplane mode and exercise classification, image
  re-inference, budgeting, lexical/fused retrieval as available, cross-chat scope,
  and generation controls. Confirm no network request occurs.
- [ ] **MV-018 / T054:** Run the Spec 006 physical-device regression: text chat,
  image chat, voice capture/transcription, History pagination/search, model
  download and verification where the fixture permits, cancellation,
  checkpoint/recovery, durable images, and offline operation.
- [ ] **T055:** Execute every phase in `quickstart.md` end to end and record all
  deviations plus a before/after comparison against the T001 baseline fixtures.

