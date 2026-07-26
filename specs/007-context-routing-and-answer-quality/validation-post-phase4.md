# Spec 007 Phase 3–4 validation

Date: 2026-07-26

Scope: T018–T033 only. This result follows the earlier
`validation-post-phase2-correction.md` record and does not replace its
pre-implementation baseline.

## Automated validation

- `npm run type-check`: passed.
- `npm run lint`: passed.
- `npm test -- --runInBand`: passed — 105 suites, 640 tests, 0 snapshots.

The full Jest suite was run after the focused routing, token-budget,
context-window, and Qwen runtime suites.

## Implemented checkpoints

- Phase 3: independent requests hard-skip all prior-context sources; ordinary
  follow-ups use recent exact turns; long-context requests alone activate
  retrieval, durable facts, and summaries.
- Phase 4: runtime context selection uses tier-1 estimated token units, five
  bounded capacity buckets, protected image evidence, and one native
  `tokenize()` verification before completion.

## Manual validation still outstanding

- Physical-device MV-012 voice-transcription parity.
- Physical-device near-window token reconciliation and multimodal capacity
  validation (MV-016).
- Final airplane-mode and broad device regression validation remain Phase 9
  work and were not performed here.
