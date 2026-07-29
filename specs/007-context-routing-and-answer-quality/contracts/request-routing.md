# Contract: Legacy Request Routing and Early Recovery

`RequestClassification` is a historical migration adapter, not an authoritative
semantic result. Authoritative fields are in
[`unified-turn-planning.md`](./unified-turn-planning.md).

## Legacy classification

The existing flags may continue in shadow diagnostics. They are deterministic,
may combine, and remain useful as a baseline. Their old semantic effects are
constrained as follows:

- `isIndependentTextQuestion` cannot globally disable exact memories, exact
  same-chat lexical matches, direct entities, attachments, explicit image
  references, user facts, or active comparison targets.
- `imageReferenceAmbiguous` cannot force `isSameImageFollowUp`. It converts to an
  `unresolved-reference` candidate set for the new planner.
- Generic detail words alone do not create pixel dependency.
- Regex/lexical patterns may identify syntax and candidates, not final semantic
  intent, dependency, memory interpretation, or image target.

## Temporary independent-routing recovery (Wave A)

Before the legacy hard skip executes, one bounded deterministic recovery checks:

1. Exact explicit-memory key/value candidates.
2. Exact same-chat lexical matches.
3. Directly referenced ledger entity IDs/unique aliases.
4. Current attachments.
5. Explicitly and uniquely referenced image IDs/ordinals.
6. Exact user-stated facts.
7. Ordered active comparison targets.

Only exact/direct candidates are protected. Recovery does not:

- add broad semantic or regex intent classification;
- query arbitrary summaries/images;
- promote assistant prose into a fact;
- guess an ambiguous image;
- enable cross-chat semantic retrieval;
- select unrelated candidates.

The recovery output is a set of required context/reference candidates with
bounded reason codes. The legacy turn remains the complete semantic authority in
shadow mode. This recovery is a temporary blast-radius reduction and is removed
when authoritative `TurnPlan` field-level requirements replace it.

## Authority interaction

- `shadow`: legacy routing, including the bounded recovery, executes the entire
  turn. The new plan is diagnostics-only.
- `controlled`: an explicitly enabled class executes its validated new plan for
  the entire turn; legacy classification/recovery is bypassed.
- `authoritative`: legacy semantic routing/recovery is not consulted.

One turn cannot combine legacy context selection with new-planner vision,
memory, generation, queue, recovery, or grounding decisions. Rollback switches
the entire turn.

## Reference handling

An image reference is resolved only by a uniquely supported target. Multiple
material candidates produce `unresolved-reference`/clarification, with no image,
pixels, or evidence selected. Active-image selection is valid only for an
unambiguous semantic reference to the active visual entity.

## Determinism and diagnostics

Legacy classification, recovery candidate construction/order, exact matching,
and conversion into planning candidates are deterministic for identical
versioned state. Diagnostics record:

- legacy flags and selection;
- recovered candidate IDs/reason codes;
- authority mode and exact plan owner;
- shadow new plan/delta;
- unresolved image candidates without an active fallback.

## Focused acceptance

- A false independent label still recovers an exact rent/unit/date/user-fact
  match.
- A false independent label cannot discard an attachment, direct image
  reference, direct entity, or active comparison pair.
- An unrelated question selects none of those sources when no exact/direct
  candidate exists.
- Two plausible image candidates remain unresolved.
- Controlled/authoritative turns make zero legacy semantic-routing decisions.
