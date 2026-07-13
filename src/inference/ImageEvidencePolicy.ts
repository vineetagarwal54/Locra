export type ImageEvidenceAvailability =
  | { readonly kind: 'use-evidence' }
  | { readonly kind: 'use-original' }
  | { readonly kind: 'original-unavailable' }
  | { readonly kind: 'evidence-unavailable' };

export interface ImageEvidenceAvailabilityInput {
  readonly assetAvailable: boolean;
  readonly hasEvidence: boolean;
  readonly pixelDependent: boolean;
}

/** Never substitutes a different image when the referenced original is missing. */
export function evaluateImageEvidenceAvailability(
  input: ImageEvidenceAvailabilityInput,
): ImageEvidenceAvailability {
  if (input.assetAvailable) {
    return input.pixelDependent || !input.hasEvidence
      ? { kind: 'use-original' }
      : { kind: 'use-evidence' };
  }
  if (input.hasEvidence && !input.pixelDependent) {
    return { kind: 'use-evidence' };
  }
  return input.pixelDependent
    ? { kind: 'original-unavailable' }
    : { kind: 'evidence-unavailable' };
}
