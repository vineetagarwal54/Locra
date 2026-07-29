# Contract: Image Continuity and Authoritative Vision Execution

The validated `TurnPlan.vision` is the only authority for image identity and
execution strategy. Legacy `ImageEvidencePolicy` may adapt planned decisions
during migration but cannot select a target or strategy independently.

## Image entity

Every image has a stable ID, source message ID, asset revision/availability,
sanitized local asset reference, evidence-version links, and timestamps.
Availability is `available | missing | deleted | unsupported`. Canonical local
pixels, derived structured evidence, and assistant prose are distinct sources.

## Vision strategies

```ts
type VisionExecutionPlan =
  | { readonly strategy: 'none' }
  | { readonly strategy: 'reuse-evidence'; readonly imageIds: readonly [string] }
  | { readonly strategy: 'inspect-original'; readonly imageIds: readonly [string] }
  | { readonly strategy: 'inspect-and-structure'; readonly imageIds: readonly [string] }
  | { readonly strategy: 'compare-evidence'; readonly imageIds: readonly string[] };
```

- `none`: no image/evidence input.
- `reuse-evidence`: use eligible structured evidence for one resolved image.
- `inspect-original`: run resolved canonical pixels for this answer.
- `inspect-and-structure`: inspect pixels and persist MVP evidence.
- `compare-evidence`: preserve at least two ordered identities/evidence sets. If
  one side is unavailable, identify that side; never substitute or merge it.

Pixel inspection and extraction use the existing single-flight
`InferenceQueue`/`DeviceResourcePolicy`; no bypass or parallel vision path is
allowed.

## Reference resolution

- Explicit ordinals and deterministic identifiers may resolve directly.
- Description, ledger, exact/lexical, and optional semantic evidence may resolve
  only when one candidate is uniquely supported.
- If two or more candidates remain materially plausible, resolution is
  `unresolved-reference` with clarification required. Select no image and do not
  present any candidate pixels/evidence as belonging to the requested image.
- The active image may be selected only when the request semantically refers to
  that active visual entity and no other candidate is materially plausible.
- The legacy ambiguity-to-active resolution value is prohibited.
- Missing/deleted assets are never silently substituted.

## Structured image-evidence MVP

```ts
interface StructuredImageEvidence {
  readonly id: string;
  readonly imageId: string;
  readonly sourceMessageIds: readonly string[];
  readonly summary: string;
  readonly visibleObjects: readonly VisibleObject[];
  readonly extractedText: readonly ExtractedTextSpan[];
  readonly numericValues: readonly NumericEvidence[];
  readonly uncertainty: EvidenceUncertainty;
  readonly status: 'complete' | 'partial' | 'failed' | 'stale';
  readonly sourceRevision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

Numeric evidence supports prices, dates, counts, units, and serial-like values.
Text/numeric evidence may optionally associate with an object ID. Full spatial
relationships and scene-graph modeling are later extensions, not Wave B MVP.

Malformed or incomplete structured output becomes `partial` or `failed`, never
silently `complete`. Asset/evidence revision mismatch produces `stale`. Original
pixel reinspection remains possible. A text-only formatting retry cannot claim
new visual facts because it has no pixels.

## Continuity and reinspection

- A normal image turn persists reusable MVP evidence or preserves an explicit
  plan/asset path for later original-pixel inspection. A direct visible answer
  cannot strand the image.
- Pixel-dependent requests with available pixels use a fresh inspection; stored
  evidence alone is insufficient.
- When pixels are missing, a pixel-dependent request reports
  `asset-unavailable`; sufficient non-stale evidence may answer only a
  non-pixel-dependent request and must be represented as reused evidence.
- Reinspection uses canonical pixels and eligible evidence. Prior assistant
  refusal, false image-unavailable prose, and unsupported visual claims are
  excluded as factual authority.
- Evidence versions remain linked to one image. Active retrieval exposes the
  newest compatible eligible version without merging image identities.

## Diagnostics and tests

Every image turn records resolved/unresolved IDs, vision strategy, asset state,
evidence status (`complete | partial | failed | stale`), and evidence action
(`reused | freshly-inspected | freshly-structured | not-produced`).

Focused tests cover active follow-ups, deterministic resolution, unresolved
ambiguity, deleted assets with stale evidence, extraction failure, refusal
exclusion, reinspection, and one-missing-side comparison. Physical validation
covers fresh pixels, persistence, restart, reinspection, and multi-image
separation.
