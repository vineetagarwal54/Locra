import type {
  ImageEntity,
} from '../persistence/ImageEntityRepository';
import type {
  StructuredImageEvidence,
} from '../persistence/StructuredImageEvidenceRepository';
import type { VisionExecutionPlan, VisionStrategy } from '../planning/types';

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

export interface VisionExecutionResult {
  readonly strategy: VisionStrategy;
  readonly status: VisionExecutionStatus;
  readonly imageInputs: readonly VisionExecutionInput[];
  readonly missingImageIds: readonly string[];
  readonly evidenceAction: VisionEvidenceAction;
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
  ): VisionExecutionResult {
    if (signal.aborted) {
      return result(plan.strategy, 'cancelled', [], plan.imageReferenceIds, 'not-produced');
    }
    if (plan.strategy === 'none') {
      return result('none', 'not-applicable', [], [], 'not-produced');
    }
    if (requiresPixels(plan.strategy) && !this.capabilities.supportsImageInput) {
      return result(
        plan.strategy,
        'capability-unavailable',
        [],
        plan.imageReferenceIds,
        'not-produced',
      );
    }
    if (
      plan.strategy === 'inspect-and-structure'
      && !this.capabilities.supportsStructuredExtraction
    ) {
      return result(
        plan.strategy,
        'capability-unavailable',
        [],
        plan.imageReferenceIds,
        'not-produced',
      );
    }

    return plan.strategy === 'reuse-evidence' || plan.strategy === 'compare-evidence'
      ? this.resolveEvidence(plan)
      : this.resolvePixels(plan);
  }

  private resolvePixels(plan: VisionExecutionPlan): VisionExecutionResult {
    const imageInputs: VisionExecutionInput[] = [];
    const missingImageIds: string[] = [];
    for (const imageId of plan.imageReferenceIds) {
      const image = this.sources.getImage(imageId);
      if (image === null || image.assetAvailability !== 'available') {
        missingImageIds.push(imageId);
        continue;
      }
      imageInputs.push({
        imageId,
        sourceMessageId: image.sourceMessageId,
        localAssetReference: image.localAssetReference,
        evidence: eligibleEvidence(this.sources.getEvidence(imageId), image),
      });
    }
    return result(
      plan.strategy,
      missingImageIds.length === 0 ? 'ready' : 'asset-unavailable',
      imageInputs,
      missingImageIds,
      plan.strategy === 'inspect-and-structure'
        ? 'freshly-structured'
        : 'freshly-inspected',
    );
  }

  private resolveEvidence(plan: VisionExecutionPlan): VisionExecutionResult {
    const imageInputs: VisionExecutionInput[] = [];
    const missingImageIds: string[] = [];
    for (const imageId of plan.imageReferenceIds) {
      const image = this.sources.getImage(imageId);
      const evidence = image === null
        ? null
        : eligibleEvidence(this.sources.getEvidence(imageId), image);
      if (image === null || evidence === null) {
        missingImageIds.push(imageId);
        continue;
      }
      imageInputs.push({
        imageId,
        sourceMessageId: image.sourceMessageId,
        localAssetReference: null,
        evidence,
      });
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
      imageInputs.length > 0 ? 'reused' : 'not-produced',
    );
  }
}

function eligibleEvidence(
  evidence: StructuredImageEvidence | null,
  image: ImageEntity,
): StructuredImageEvidence | null {
  if (
    evidence === null
    || evidence.status === 'failed'
    || evidence.status === 'stale'
    || (
      evidence.sourceRevision !== image.assetRevision
      && !evidence.sourceRevision.startsWith(`${image.assetRevision}:`)
    )
  ) {
    return null;
  }
  return evidence;
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
): VisionExecutionResult {
  return {
    strategy,
    status,
    imageInputs,
    missingImageIds,
    evidenceAction,
    replanned: false,
  };
}
