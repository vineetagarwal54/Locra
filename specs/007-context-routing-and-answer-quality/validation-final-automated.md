# Spec 007 final automated validation and correction audit

Date: 2026-07-26

Branch: `feat/context-routing-v2`

Base commit: `1a99236788a4e4a8699ab7479fb28d037e795783`

State: uncommitted working-tree corrections; nothing staged, committed, or pushed.

## Complete automated validation

- `npm run type-check`: passed.
- `npm run lint`: passed.
- `npm test -- --runInBand`: passed — 110 suites, 765 tests,
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
- `GenerationPlan` separates `softTargetTokens` from
  `hardSafetyLimitTokens`. Normal visible prose and continuations retain the
  response-mode maximum (320/640/1024); only structurally bounded output may use
  a smaller native cap.
- The effective native limit is propagated once to `n_predict` and returned
  through runtime, objective-record, trace, and production-summary diagnostics
  alongside the distinct soft target and response-mode maximum.
- Retrieved context is factual conversation data while embedded instructions
  remain non-authoritative. Multi-image comparisons deliver separately labeled,
  provenance-bearing evidence in the final Qwen messages.

## Task truthfulness and remaining gates

Automated source implementation through optional Phase 8 is complete, but the
task ledger is not fully complete: 53 of 59 tasks are checked. These six
physical/manual tasks remain open:

- T034: native `stopCompletion()` hardware acceptance, partial persistence,
  resource release, next-inference readiness, and loop/cancellation race checks.
- T052: full MV-001–MV-018 manual matrix and before/after comparison.
- T053: final airplane-mode validation.
- T054: Spec 006 physical-device regression checklist.
- T055: quickstart Phases 1–9 end-to-end on a physical device.
- T058: corrected output-limit, retrieval-memory, and multi-image device matrix.

No physical-device success is claimed. The corrected output-limit path still
requires retesting against the observed mid-sentence and mid-list truncation
probes, plus exact-value retrieval and two-image comparison.

The production embedding artifact is not approved or activated by Spec 007.
Runtime behavior remains lexical-only until the separate manifest, license, hash,
dimension, latency, memory, and device-compatibility approval gate is completed.

Use [manual-validation-checklist.md](./manual-validation-checklist.md) to record
the remaining physical results.

## Specification-only architecture revision (2026-07-28)

The automated results above are a historical record of the first Spec 007
implementation as of 2026-07-26. They do not validate the revised `TurnPlan`,
conversation-state ledger, immediate-memory, EmbeddingGemma provider/index,
typed-unit retrieval, main-provider boundary, or plan-driven vision contracts.

This revision changed specification artifacts only. No production source, test,
database migration, model artifact, dependency, or configuration file was
changed, and no new automated or physical validation is claimed.

New implementation work is listed unchecked as T059–T110. The existing task
file also contains two historical completed tasks labeled T056; their text and
checkboxes are preserved, and new numbering starts after the existing maximum
T058 rather than rewriting task history.

Required future automated coverage includes:

- `TurnPlan` schema/validation and field-level fallback;
- tiered planning and constrained fallback validation;
- eight golden architecture scenarios;
- ledger transitions, provenance, revision invalidation, and deletion cascade;
- immediate explicit memory availability before compaction/indexing;
- typed-unit reliability and multi-signal retrieval;
- EmbeddingProvider readiness/cancellation/index lifecycle and 256/512
  dimension evaluation inputs;
- MainInferenceProvider capability and substitution contracts;
- plan-driven single/multi-image execution and refusal-exclusion;
- one-plan authority across context, vision, generation, queue, recovery, and
  grounding.

The complete future physical matrix is recorded in
[manual-validation-checklist.md](./manual-validation-checklist.md).
