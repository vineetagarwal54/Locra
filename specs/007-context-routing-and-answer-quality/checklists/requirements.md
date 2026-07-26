# Specification Quality Checklist: Context Routing and Answer Quality

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- This is an internal engineering feature extending an existing on-device architecture (Spec 006). Consistent with that spec's precedent, functional requirements reference existing concrete components (`ContextOrchestrator`, `HybridRetriever`, `ImageEvidencePolicy`, `AnswerPostProcessor`, `ContextWindow`) by name where doing so is necessary for the requirement to be unambiguous and testable — this is treated as naming the existing system being extended, not prescribing a new implementation.
- No [NEEDS CLARIFICATION] markers were used. Scope-significant ambiguities (semantic-retrieval activation ownership, cross-chat opt-in shape and per-conversation exclusion, token-budget measurement mechanism, ambiguous-image-reference resolution, and the grounding-check's optional/deferred status) were resolved with explicit, documented decisions in the Assumptions/Superseded Requirements/Preserved Foundations sections and a non-binding phase ordering (Section 14) rather than left blocking. Five follow-up questions remain in Section 13 (Open Questions) for `/speckit-clarify` or `/speckit-plan`.
- Revision (2026-07-26, pass 1): reworked token budgeting to be model/token-aware rather than character-based, split request classification into eight combinable categories, tightened the independent-question zero-context rule, required "use original image" to mean genuine re-inference, required lexical/semantic fusion instead of override, added per-conversation cross-chat exclusion, added task-sensitive output limits and earlier loop stopping, relaxed post-processing to "improvable" rather than "unchanged," deferred the grounding assessment and cross-chat retrieval to explicit later phases, reduced the automated-test list to five focused areas, and added Section 14 (Implementation Phasing).
- Revision (2026-07-26, pass 2 — full audit against 25 correction items): fixed a real contradiction where the token-budget eviction order (old FR-030) implied an unconditionally protected recent-turn floor even for independent questions, contradicting FR-003/FR-004's zero-context rule — floor protection is now explicitly conditioned on the request having a floor to begin with. Added: reserved five-bucket token capacity (FR-026a) and a two-tier runtime-preferred/calibrated-fallback measurement (FR-026b, after investigating `llama.rn`'s actual `tokenize()` API); an exact-match fusion guarantee for names/numbers/prices/dates/identifiers (FR-019a); an ambiguous-image-reference default rule (FR-012a) so a genuinely unclear reference among 3+ images never guesses; a runtime-verification requirement for any generation/sampling constant (FR-036a); explicit "MUST NOT rewrite or suppress" language for the optional grounding assessment; a "Superseded Requirements" section naming exactly what overrides Spec 006 behavior; a "Preserved Foundations" section naming what stays untouched; and explicit "will not introduce" Non-Goals (second inference queue, cloud processing, multi-image attachments, PDF support, live camera, UI redesign, model marketplace). Removed the now-decided "voice confidence signal" open question (Assumptions already resolved it) and moved the manual-validation matrix from 11 to 18 named scenarios matching the requested coverage. Renumbered `tasks.md` phases to match `plan.md`/spec Section 14's canonical 1–9 sequence exactly (previously off-by-one due to a separate "Foundational" phase label) and removed two automated-test tasks (voice-routing parity, generation/loop-detector unit tests) that fell outside the five approved test areas, replacing them with manual-validation checkpoints; added tasks for the ambiguous-reference default, the reserved buckets, and the exact-match guarantee.
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
