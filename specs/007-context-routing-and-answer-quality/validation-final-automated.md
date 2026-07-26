# Spec 007 final automated validation and correction audit

Date: 2026-07-26

Branch: `feat/context-routing-v2`

Base commit: `1a99236788a4e4a8699ab7479fb28d037e795783`

State: uncommitted working-tree corrections; nothing staged, committed, or pushed.

## Complete automated validation

- `npm run type-check`: passed.
- `npm run lint`: passed.
- `npm test -- --runInBand`: passed — 107 suites, 727 tests,
  0 snapshots.
- `git diff --check`: passed.

The commands above were run against the final corrected working tree, not the
pre-implementation baseline.

## Corrected implementation

- Pixel/detail vocabulary requires a deterministic visual anchor; unrelated
  cost/count/total/number/color questions do not activate stale image context.
- Same-chat long-context eligibility and explicit cross-chat-memory eligibility
  are independent. Cross-chat works from new/short chats, remains off by default,
  preserves bilateral exclusions, and reports queried/selected usage.
- Query embedding follows deterministic classification and is never called for
  independent or ordinary non-retrieval turns. Semantic runtime remains gated.
- Final Qwen prompt reconciliation is bounded and repeatedly tokenizes after
  reductions; current input and image paths are protected and completion is not
  called without a verified fit.
- Protected image evidence is reserved before lower-priority context and final
  diagnostics maintain `usedUnits <= maximumUnits`.
- Fresh `hiddenEvidence` participates only in grounding diagnostics; canonical
  context and visible answers are unchanged.
- Exact lexical protection retains first-position/multi-word names, numbers,
  prices, dates, and identifiers while filtering generic command/question words.
- `QwenLlamaRuntime` is the sole loop-triggered native stop owner; mocked
  cancellation/loop behavior is deterministic and idempotent.

## Task truthfulness and remaining gates

Automated source implementation through optional Phase 8 is complete, but the
task ledger is not fully complete: 51 of 56 tasks are checked. These five
physical/manual tasks remain open:

- T034: native `stopCompletion()` hardware acceptance, partial persistence,
  resource release, next-inference readiness, and loop/cancellation race checks.
- T052: full MV-001–MV-018 manual matrix and before/after comparison.
- T053: final airplane-mode validation.
- T054: Spec 006 physical-device regression checklist.
- T055: quickstart Phases 1–9 end-to-end on a physical device.

No physical-device result is claimed.

The production embedding artifact is not approved or activated by Spec 007.
Runtime behavior remains lexical-only until the separate manifest, license, hash,
dimension, latency, memory, and device-compatibility approval gate is completed.

Use [manual-validation-checklist.md](./manual-validation-checklist.md) to record
the remaining physical results.
