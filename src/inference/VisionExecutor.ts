import type {
  ImageEntity,
} from '../persistence/ImageEntityRepository';
import type {
  StructuredImageEvidence,
} from '../persistence/StructuredImageEvidenceRepository';
import type { VisionExecutionPlan, VisionStrategy } from '../planning/types';

import {
  evaluateEvidenceSufficiency,
  type EvidenceObservedStatus,
  type EvidenceSufficiencyReason,
} from './EvidenceSufficiency';
import {
  STRUCTURED_VISUAL_EXTRACTION_SCHEMA_VERSION,
} from './StructuredVisualExtraction';

export interface VisionExecutorSources {
  getImage(imageId: string): ImageEntity | null;
  getEvidence(imageId: string): StructuredImageEvidence | null;
}

export interface VisionExecutorCapabilities {
  readonly supportsImageInput: boolean;
  readonly supportsStructuredExtraction: boolean;
}

export type VisionExecutionStatus =
  | 'not-applicable'
  | 'ready'
  | 'partial'
  | 'asset-unavailable'
  | 'evidence-unavailable'
  | 'capability-unavailable'
  | 'cancelled';

export type VisionEvidenceAction =
  | 'reused'
  | 'freshly-inspected'
  | 'freshly-structured'
  | 'not-produced';

export interface VisionExecutionInput {
  readonly imageId: string;
  readonly sourceMessageId: string;
  readonly localAssetReference: string | null;
  readonly evidence: StructuredImageEvidence | null;
}

export type VisionImageEvidenceAction =
  | 'reused-evidence'
  | 'pixel-inspection'
  | 'unavailable'
  | 'not-applicable';

export type VisionExtractionValidity =
  | 'pending'
  | 'valid'
  | 'invalid'
  | 'not-evaluated';

export interface VisionComparisonProvenance {
  readonly side: number;
  readonly imageId: string;
  readonly sourceMessageId: string;
  readonly evidenceId: string | null;
}

export interface VisionImageDiagnostic {
  readonly imageId: string;
  readonly evidenceStatus: EvidenceObservedStatus;
  readonly sufficiencyResult: 'sufficient' | 'insufficient' | 'not-evaluated';
  readonly sufficiencyReason:
    | EvidenceSufficiencyReason
    | 'not-evaluated'
    | 'asset-unavailable'
    | 'capability-unavailable';
  readonly action: VisionImageEvidenceAction;
  readonly extractionSchemaVersion: string | null;
  readonly extractionValidity: VisionExtractionValidity;
  readonly comparisonProvenance: VisionComparisonProvenance | null;
  readonly uncertaintyOrFailureReason: string | null;
}

export interface VisionExecutionOptions {
  readonly question?: string;
}

export interface VisionExecutionResult {
  readonly strategy: VisionStrategy;
  readonly status: VisionExecutionStatus;
  readonly imageInputs: readonly VisionExecutionInput[];
  readonly missingImageIds: readonly string[];
  readonly evidenceAction: VisionEvidenceAction;
  readonly imageDiagnostics: readonly VisionImageDiagnostic[];
  readonly pixelInspectionImageIds: readonly string[];
  readonly requiresStructuredExtraction: boolean;
  readonly failureReason: string | null;
  readonly replanned: false;
}

const DEFAULT_CAPABILITIES: VisionExecutorCapabilities = {
  supportsImageInput: true,
  supportsStructuredExtraction: true,
};

export class VisionExecutor {
  constructor(
    private readonly sources: VisionExecutorSources,
    private readonly capabilities: VisionExecutorCapabilities = DEFAULT_CAPABILITIES,
  ) {}

  execute(
    plan: VisionExecutionPlan,
    signal: AbortSignal,
    options: VisionExecutionOptions = {},
  ): VisionExecutionResult {
    if (signal.aborted) {
      return result(plan.strategy, 'cancelled', [], plan.imageReferenceIds, 'not-produced');
    }
    if (plan.strategy === 'none') {
      return result('none', 'not-applicable', [], [], 'not-produced');
    }
    if (requiresPixels(plan.strategy) && !this.capabilities.supportsImageInput) {
      return this.capabilityUnavailable(plan);
    }
    if (
      plan.strategy === 'inspect-and-structure'
      && !this.capabilities.supportsStructuredExtraction
    ) {
      return this.capabilityUnavailable(plan);
    }

    return plan.strategy === 'reuse-evidence' || plan.strategy === 'compare-evidence'
      ? this.resolveEvidence(plan, options.question ?? '')
      : this.resolvePixels(plan);
  }

  private capabilityUnavailable(plan: VisionExecutionPlan): VisionExecutionResult {
    return result(
      plan.strategy,
      'capability-unavailable',
      [],
      plan.imageReferenceIds,
      'not-produced',
      plan.imageReferenceIds.map((imageId) => unavailableDiagnostic(
        imageId,
        evidenceStatus(this.sources.getEvidence(imageId)),
        'capability-unavailable',
        null,
      )),
      [],
      false,
      'vision-capability-unavailable',
    );
  }

  private resolvePixels(plan: VisionExecutionPlan): VisionExecutionResult {
    const imageInputs: VisionExecutionInput[] = [];
    const missingImageIds: string[] = [];
    const imageDiagnostics: VisionImageDiagnostic[] = [];
    for (const imageId of plan.imageReferenceIds) {
      const image = this.sources.getImage(imageId);
      if (image === null || image.assetAvailability !== 'available') {
        missingImageIds.push(imageId);
        imageDiagnostics.push(unavailableDiagnostic(
          imageId,
          image === null ? 'missing' : evidenceStatus(this.sources.getEvidence(imageId)),
          'asset-unavailable',
          null,
        ));
        continue;
      }
      imageInputs.push({
        imageId,
        sourceMessageId: image.sourceMessageId,
        localAssetReference: image.localAssetReference,
        evidence: null,
      });
      imageDiagnostics.push({
        imageId,
        evidenceStatus: evidenceStatus(this.sources.getEvidence(imageId)),
        sufficiencyResult: 'not-evaluated',
        sufficiencyReason: 'not-evaluated',
        action: 'pixel-inspection',
        extractionSchemaVersion: plan.strategy === 'inspect-and-structure'
          ? STRUCTURED_VISUAL_EXTRACTION_SCHEMA_VERSION
          : null,
        extractionValidity: plan.strategy === 'inspect-and-structure'
          ? 'pending'
          : 'not-evaluated',
        comparisonProvenance: null,
        uncertaintyOrFailureReason: null,
      });
    }
    return result(
      plan.strategy,
      missingImageIds.length === 0 ? 'ready' : 'asset-unavailable',
      imageInputs,
      missingImageIds,
      imageInputs.length === 0
        ? 'not-produced'
        : plan.strategy === 'inspect-and-structure'
          ? 'freshly-structured'
          : 'freshly-inspected',
      imageDiagnostics,
      imageInputs.map((input) => input.imageId),
      plan.strategy === 'inspect-and-structure',
      missingImageIds.length === 0
        ? null
        : `selected-image-asset-unavailable:${missingImageIds[0]}`,
    );
  }

  private resolveEvidence(
    plan: VisionExecutionPlan,
    question: string,
  ): VisionExecutionResult {
    const imageInputs: VisionExecutionInput[] = [];
    const missingImageIds: string[] = [];
    const imageDiagnostics: VisionImageDiagnostic[] = [];
    const pixelInspectionImageIds: string[] = [];
    for (const [side, imageId] of plan.imageReferenceIds.entries()) {
      const image = this.sources.getImage(imageId);
      const evidence = image === null ? null : this.sources.getEvidence(imageId);
      const provenance = image === null || plan.strategy !== 'compare-evidence'
        ? null
        : comparisonProvenance(side, image, evidence);
      if (image === null) {
        missingImageIds.push(imageId);
        imageDiagnostics.push(unavailableDiagnostic(
          imageId,
          'missing',
          'asset-unavailable',
          provenance,
        ));
        continue;
      }
      if (
        plan.strategy === 'compare-evidence'
        && image.assetAvailability !== 'available'
      ) {
        missingImageIds.push(imageId);
        imageDiagnostics.push(unavailableDiagnostic(
          imageId,
          evidenceStatus(evidence),
          'asset-unavailable',
          provenance,
        ));
        continue;
      }
      const sufficiency = evaluateEvidenceSufficiency({ question, image, evidence });
      if (!sufficiency.sufficient) {
        if (
          image.assetAvailability !== 'available'
          || !this.capabilities.supportsImageInput
          || !this.capabilities.supportsStructuredExtraction
        ) {
          missingImageIds.push(imageId);
          const reason = image.assetAvailability === 'available'
            ? 'capability-unavailable'
            : 'asset-unavailable';
          imageDiagnostics.push(unavailableDiagnostic(
            imageId,
            sufficiency.evidenceStatus,
            reason,
            provenance,
            sufficiency.reason,
          ));
          continue;
        }
        imageInputs.push({
          imageId,
          sourceMessageId: image.sourceMessageId,
          localAssetReference: image.localAssetReference,
          evidence: null,
        });
        pixelInspectionImageIds.push(imageId);
        imageDiagnostics.push({
          imageId,
          evidenceStatus: sufficiency.evidenceStatus,
          sufficiencyResult: 'insufficient',
          sufficiencyReason: sufficiency.reason,
          action: 'pixel-inspection',
          extractionSchemaVersion: STRUCTURED_VISUAL_EXTRACTION_SCHEMA_VERSION,
          extractionValidity: 'pending',
          comparisonProvenance: provenance,
          uncertaintyOrFailureReason: sufficiency.reason,
        });
        continue;
      }
      imageInputs.push({
        imageId,
        sourceMessageId: image.sourceMessageId,
        localAssetReference: null,
        evidence,
      });
      imageDiagnostics.push({
        imageId,
        evidenceStatus: sufficiency.evidenceStatus,
        sufficiencyResult: 'sufficient',
        sufficiencyReason: sufficiency.reason,
        action: 'reused-evidence',
        extractionSchemaVersion: storedExtractionVersion(evidence),
        extractionValidity: 'valid',
        comparisonProvenance: provenance,
        uncertaintyOrFailureReason: null,
      });
    }
    if (plan.strategy === 'compare-evidence' && pixelInspectionImageIds.length > 1) {
      const reason = 'comparison-multiple-reinspection-unavailable';
      return result(
        plan.strategy,
        'capability-unavailable',
        imageInputs.map((input) => ({
          ...input,
          localAssetReference: null,
        })),
        missingImageIds,
        'not-produced',
        imageDiagnostics.map((diagnostic) => diagnostic.action === 'pixel-inspection'
          ? {
              ...diagnostic,
              action: 'unavailable',
              extractionValidity: 'not-evaluated',
              uncertaintyOrFailureReason: reason,
            }
          : diagnostic),
        [],
        false,
        reason,
      );
    }
    const status = missingImageIds.length === 0
      ? 'ready'
      : imageInputs.length === 0
        ? 'evidence-unavailable'
        : 'partial';
    return result(
      plan.strategy,
      status,
      imageInputs,
      missingImageIds,
      pixelInspectionImageIds.length > 0
        ? 'freshly-structured'
        : imageInputs.length > 0
          ? 'reused'
          : 'not-produced',
      imageDiagnostics,
      pixelInspectionImageIds,
      pixelInspectionImageIds.length > 0,
      imageDiagnostics.some(
        (diagnostic) => diagnostic.uncertaintyOrFailureReason === 'capability-unavailable',
      )
        ? 'vision-capability-unavailable'
        : failureReasonFor(plan, missingImageIds),
    );
  }
}

function requiresPixels(strategy: VisionStrategy): boolean {
  return strategy === 'inspect-original' || strategy === 'inspect-and-structure';
}

function result(
  strategy: VisionStrategy,
  status: VisionExecutionStatus,
  imageInputs: readonly VisionExecutionInput[],
  missingImageIds: readonly string[],
  evidenceAction: VisionEvidenceAction,
  imageDiagnostics: readonly VisionImageDiagnostic[] = [],
  pixelInspectionImageIds: readonly string[] = [],
  requiresStructuredExtraction = false,
  failureReason: string | null = null,
): VisionExecutionResult {
  return {
    strategy,
    status,
    imageInputs,
    missingImageIds,
    evidenceAction,
    imageDiagnostics,
    pixelInspectionImageIds,
    requiresStructuredExtraction,
    failureReason,
    replanned: false,
  };
}

function evidenceStatus(
  evidence: StructuredImageEvidence | null,
): EvidenceObservedStatus {
  return evidence?.status ?? 'missing';
}

function storedExtractionVersion(evidence: StructuredImageEvidence | null): string {
  if (evidence === null) return 'stored-structured-evidence-version-unknown';
  const marker = ':evidence:';
  const markerIndex = evidence.sourceRevision.indexOf(marker);
  return markerIndex < 0
    ? 'stored-structured-evidence-version-unknown'
    : evidence.sourceRevision.slice(markerIndex + marker.length);
}

function comparisonProvenance(
  side: number,
  image: ImageEntity,
  evidence: StructuredImageEvidence | null,
): VisionComparisonProvenance {
  return {
    side,
    imageId: image.id,
    sourceMessageId: image.sourceMessageId,
    evidenceId: evidence?.id ?? null,
  };
}

function unavailableDiagnostic(
  imageId: string,
  status: EvidenceObservedStatus,
  reason: 'asset-unavailable' | 'capability-unavailable',
  provenance: VisionComparisonProvenance | null,
  sufficiencyReason:
    | EvidenceSufficiencyReason
    | 'asset-unavailable'
    | 'capability-unavailable' = reason,
): VisionImageDiagnostic {
  return {
    imageId,
    evidenceStatus: status,
    sufficiencyResult: 'insufficient',
    sufficiencyReason,
    action: 'unavailable',
    extractionSchemaVersion: null,
    extractionValidity: 'not-evaluated',
    comparisonProvenance: provenance,
    uncertaintyOrFailureReason: reason,
  };
}

function failureReasonFor(
  plan: VisionExecutionPlan,
  missingImageIds: readonly string[],
): string | null {
  if (missingImageIds.length === 0) return null;
  return plan.strategy === 'compare-evidence'
    ? `comparison-side-unavailable:${missingImageIds[0]}`
    : `insufficient-evidence-and-asset-unavailable:${missingImageIds[0]}`;
}
