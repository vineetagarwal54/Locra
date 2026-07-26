# Contract: Image Continuity and Original-Pixel Reuse

**Module**: extended `src/inference/ImageEvidencePolicy.ts` + extended `src/inference/ContextOrchestrator.ts` | Consumers: `store/conversationStore.ts`, `InferenceService`

## ImageEvidencePolicy (extended, still pure)

```ts
export type ImageEvidenceAvailability =
  | { readonly kind: 'use-original' }        // MUST trigger fresh vision inference (see below)
  | { readonly kind: 'use-evidence' }
  | { readonly kind: 'original-unavailable' }
  | { readonly kind: 'evidence-unavailable' };

export interface ImageEvidenceAvailabilityInput {
  readonly assetAvailable: boolean;
  readonly hasEvidence: boolean;
  readonly pixelDependent: boolean; // NOW populated from RequestClassification.isPixelDependent
}

export function evaluateImageEvidenceAvailability(
  input: ImageEvidenceAvailabilityInput,
): ImageEvidenceAvailability; // unchanged logic; now actually called
```

- **MUST** be invoked by `ContextOrchestrator` for every request where `isNewImageQuestion || isSameImageFollowUp || isOlderImageReference || isPixelDependent` is true (spec FR-007). Today this function exists and is unit-tested but is never called from the orchestrator — this contract closes that gap.
- **MUST NOT** change its existing decision logic; only its caller and the population of `pixelDependent` change.

## "Use original image" re-inference (new behavior)

When `evaluateImageEvidenceAvailability` returns `{ kind: 'use-original' }`:

- The orchestrator (or its caller in `InferenceService`) **MUST** issue a new vision-inference call on the original local image file through the existing single-flight `InferenceQueue`/`DeviceResourcePolicy` — the same path used for a brand-new image question — rather than reusing or relabeling the existing stored evidence text (spec FR-008).
- The resulting fresh evidence **MUST** be persisted as a new, versioned evidence row via the existing `EvidenceRepository` (same versioning scheme as first-time evidence), linked to the current message and the same `image_asset_id` as the original evidence.
- This re-inference **MUST** go through the same queueing/resource-policy path as any other inference — no priority bypass (spec edge case: "queues normally like any other inference request").

## Older-image and missing-original resolution (unchanged logic, now reachable)

- `isOlderImageReference` resolves via `EvidenceRepository.resolveReferencedImageEvidence` (existing) using `RequestClassification.referencedImageId`; never falls back to the conversation's current/active image (spec FR-010, no silent substitution).
- `original-unavailable` (pixel-dependent, asset missing) **MUST** surface as a response indicating the original is unavailable, not a guess from stale evidence (spec FR-011).
- `evidence-unavailable` combined with non-pixel-dependent and no evidence is unchanged from Spec 006 (no evidence available at all).

## Invariants

- A request classified as pixel-dependent with an available original asset always resolves to `use-original`, even if sufficient stored evidence already exists (spec FR-009) — evidence sufficiency does not override pixel-dependence.
- A missing image is never silently substituted with a different image (spec FR-010) — unchanged Spec 006 guarantee, now enforced through the wired policy rather than only through evidence-repository behavior.
