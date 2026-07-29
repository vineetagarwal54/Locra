# Specification Quality Checklist: Context Routing and Answer Quality

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] Named existing-system implementation constraints are intentional and acceptable for this internal engineering specification; no unnecessary new technology is prescribed.
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria remain outcome-focused while explicitly named existing-system constraints are treated as intentional engineering requirements.
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] Implementation details appear only where required to preserve existing architecture, runtime safety, persistence, and validation constraints.

## Notes

- This is an internal engineering feature extending an existing on-device architecture (Spec 006). Consistent with that spec's precedent, functional requirements reference existing concrete components (`ContextOrchestrator`, `HybridRetriever`, `ImageEvidencePolicy`, `AnswerPostProcessor`, `ContextWindow`) by name where doing so is necessary for the requirement to be unambiguous and testable — this is treated as naming the existing system being extended, not prescribing a new implementation.
- No [NEEDS CLARIFICATION] markers were used. Scope-significant ambiguities (semantic-retrieval activation ownership, cross-chat opt-in shape and per-conversation exclusion, token-budget measurement mechanism, ambiguous-image-reference resolution, and the grounding-check's optional/deferred status) were resolved with explicit, documented decisions in the Assumptions/Superseded Requirements/Preserved Foundations sections and a non-binding phase ordering (Section 14) rather than left blocking. Five follow-up questions remain in Section 13 (Open Questions) for `/speckit-clarify` or `/speckit-plan`.
- Revision (2026-07-26, pass 1): reworked token budgeting to be model/token-aware rather than character-based, split request classification into eight combinable categories, tightened the independent-question zero-context rule, required "use original image" to mean genuine re-inference, required lexical/semantic fusion instead of override, added per-conversation cross-chat exclusion, added task-sensitive output limits and earlier loop stopping, relaxed post-processing to "improvable" rather than "unchanged," deferred the grounding assessment and cross-chat retrieval to explicit later phases, reduced the automated-test list to five focused areas, and added Section 14 (Implementation Phasing).
- Revision (2026-07-26, pass 2 — historical): fixed the conditional recent-turn
  floor and added the then-current disclosed active-image fallback. The
  2026-07-28 architectural correction explicitly supersedes that fallback.
- Revision (2026-07-26, pass 3 — implementation correction audit):
  visual detail terms require a real visual anchor; cross-chat intent is
  independent from same-chat length; native prompt reconciliation is bounded and
  repeated until verified; protected evidence cannot overrun diagnostics; fresh
  hidden evidence participates in grounding; first-position names survive exact
  matching; and classification precedes embedding generation. T034 and
  T052–T055 remain explicitly incomplete physical-device tasks, so this checklist
  does not claim every implementation task has hardware acceptance.
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
- Revision (2026-07-28 — unified architecture): validated one authoritative
  `TurnPlan`; tiered deterministic/semantic/constrained-model/validation
  planning; conversation-state ledger; immediate explicit memory; typed
  provenance/reliability-aware retrieval units; EmbeddingGemma behind a
  model-independent provider with 256/512 dimension benchmarking and versioned
  index migration; current Qwen behind a model-independent main provider;
  plan-driven single/multi-image execution; provider-native prompt verification;
  twelve-stage shadow-to-authoritative rollout; and all eight required golden
  scenarios.
- Earlier contradictory decisions are explicitly superseded in spec Section 18
  and research Section 22 rather than silently coexisting: regex-primary
  semantics, binary independent-question context removal, active-image fallback
  for ambiguity, application-wide Qwen coupling, and downstream semantic
  reclassification.
- Open questions in spec Section 20 are benchmark/implementation decisions with
  safe gated defaults. No unresolved question permits activation without
  artifact/runtime/device evidence, so no `[NEEDS CLARIFICATION]` marker is
  required for specification readiness.
- Correction (2026-07-28): ambiguous image references now remain unresolved;
  planner authority is embedding-independent; Tier 3 has a bounded partial-field
  contract and separate latency budget; deterministic guarantees exclude raw
  model bytes but include validation/post-processing; general message editing is
  out of scope; authority modes enforce one owner; immediate ledger publication,
  conservative explicit-memory semantics, ordinal reliability, MVP image
  evidence, and Waves A–E are fully specified. The duplicate task ID was
  corrected from the later `T056` to `T111`.
