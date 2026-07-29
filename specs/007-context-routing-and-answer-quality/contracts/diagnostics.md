# Contract: Turn Planning and Context Diagnostics

Diagnostics expose sanitized execution ownership and evidence. They do not
expose hidden prompts/reasoning, raw model IDs, pixels, or secrets.

```ts
interface TurnArchitectureDiagnostics {
  readonly turnId: string;
  readonly authorityMode: 'shadow' | 'controlled' | 'authoritative';
  readonly planOwner: string;
  readonly executedPlanId: string;
  readonly executedPlanVersion: string;
  readonly legacyClassification: RequestClassification | null;
  readonly shadowPlan: SanitizedTurnPlan | null;
  readonly planDelta: readonly PlanDelta[];
  readonly independentRecovery: IndependentRecoveryDiagnostic;
  readonly referenceResolution: ReferenceResolutionDiagnostic;
  readonly constrainedPlanner: ConstrainedPlannerDiagnostic;
  readonly selectedSources: readonly SourceSelectionDiagnostic[];
  readonly vision: VisionExecutionDiagnostic;
  readonly retrieval: RetrievalDiagnostic;
  readonly validationChanges: readonly ValidationChange[];
  readonly fallback: string;
  readonly executionOutcome: string;
}
```

## Authority fields

- `shadow`: `planOwner` identifies the versioned legacy router; `executedPlanId`
  points to the legacy execution record. The new plan is present only in
  `shadowPlan`. Tier 3 records `wouldInvoke` but is not called live inline.
- `controlled`/`authoritative`: `planOwner` identifies the new planner and
  `executedPlanId` is its validated plan. Legacy classification is diagnostic or
  absent and cannot own a sub-operation.
- Every semantic consumer records the same executed plan ID/version. A mismatch
  is an invariant violation.

## Reference resolution enum

```ts
type ImageReferenceResolution =
  | 'not-applicable'
  | 'new-image'
  | 'active-image'
  | 'explicit-ordinal'
  | 'unique-description'
  | 'unresolved-reference'
  | 'clarification-required'
  | 'asset-unavailable';
```

The legacy ambiguity-to-active enum is prohibited. `active-image` means the request
unambiguously referred to the active visual entity; it is not an ambiguity
fallback. Unresolved diagnostics include ordered candidate IDs but no selected
image/evidence ID.

## Constrained planner diagnostics

Always record:

- `invoked`;
- deterministic gate outcome/reason;
- requested unresolved fields and candidate IDs;
- resource queue wait and execution latency separately;
- output token count and timeout/cancellation/suspension status;
- schema/candidate validation result;
- confidence and threshold;
- bounded rationale codes;
- accepted/rejected and conservative fallback.

Golden diagnostics must show `invoked: false`.

## Vision and evidence diagnostics

Record image IDs, asset availability, authoritative strategy, whether pixels
were inspected, and evidence status/action:

- status: `complete | partial | failed | stale | not-applicable`;
- action: `reused | freshly-inspected | freshly-structured | not-produced`.

Fresh reinspection records refusal-like prior attempts as excluded, never as
selected factual evidence.

## Retrieval and reliability diagnostics

Record exact/lexical/semantic/entity/provenance/reliability/scope/recency signals,
eligible/considered/selected counts, provider/index descriptor when used, and
`fused | lexical-fallback | none`. The ordinal reliability class and exclusion
reason are visible for each candidate. Ineligible attempts cannot be selected as
trusted factual evidence.

## Shadow persistence

Shadow diagnostics may be persisted separately as derived records. They cannot
update visible context, image choice, memory, ledger execution results, answer
generation, or canonical messages. Shadow record failure cannot fail the legacy
turn.

## Required audits

- No single turn has two `planOwner` values across consumers.
- Controlled classes bypass all legacy semantic decisions.
- Authoritative turns do not consult legacy semantics.
- Full-turn rollback changes owner for the whole turn.
- Exact/direct recovery records why a false independent label did not suppress a
  source.
- App suspension/cancellation leaves a terminal planner diagnostic and releases
  the single-flight resource.
