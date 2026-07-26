# Spec 007 final automated validation and alignment

Date: 2026-07-26

## Automated validation

- `npm run type-check`: passed against the final aligned source state.
- `npm run lint`: passed against the final aligned source state.
- `npm test -- --runInBand`: passed against the final aligned source state —
  107 suites, 660 tests, 0 snapshots.

## Implemented alignment

- Phases 1–8 implementation tasks are complete, including optional Phase 8.
- Cross-chat memory is off by default, local-only, immediately reversible, and
  supports bilateral per-conversation exclusion.
- Semantic retrieval remains behind the unapproved embedding-manifest gate;
  lexical cross-chat retrieval remains available when the user opts in.
- Grounding assessment is deterministic and diagnostics-only. It never changes
  the visible answer and runs only when selected image/retrieved evidence exists.
- README architecture wording now reflects classification routing, token-based
  budgeting, hybrid fusion, and optional cross-chat memory.

## Truthful outstanding tasks

- T034: physical-device verification of native loop stopping and partial-text
  preservation.
- T052: full MV-001–MV-018 manual matrix and before/after fixture comparison.
- T053: final airplane-mode validation.
- T054: Spec 006 physical-device regression checklist.
- T055: quickstart Phases 1–9 end-to-end on a physical device.

No physical-device result is claimed in this record.
Use [manual-validation-checklist.md](./manual-validation-checklist.md) to record
those remaining results.
