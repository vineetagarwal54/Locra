import type {
  ContextSourceRequirement,
  MemoryReadRequirement,
  MemoryWriteRequirement,
  ResolvedReference,
  TurnPlan,
  TurnPlanValidationChange,
  TurnPlanValidationResult,
  UnresolvedReference,
  VisionExecutionPlan,
} from './types';

export interface TurnPlanProviderCapabilities {
  readonly supportsImageInput: boolean;
  readonly supportsStructuredExtraction: boolean;
}

const DEFAULT_PROVIDER_CAPABILITIES: TurnPlanProviderCapabilities = {
  supportsImageInput: true,
  supportsStructuredExtraction: true,
};

export function validateTurnPlan(
  input: TurnPlan,
  providerCapabilities: TurnPlanProviderCapabilities = DEFAULT_PROVIDER_CAPABILITIES,
): TurnPlanValidationResult {
  const changes: TurnPlanValidationChange[] = [];
  let plan = normalizePlan(input, changes);
  plan = rejectUncertainDurableWrites(plan, changes);
  plan = enforceReferenceSafety(plan, changes);
  plan = enforceProviderCapabilities(plan, providerCapabilities, changes);

  return {
    valid: true,
    plan,
    changes,
  };
}

function normalizePlan(
  plan: TurnPlan,
  changes: TurnPlanValidationChange[],
): TurnPlan {
  const confidence = clampConfidence(plan.confidence.overall);
  if (confidence !== plan.confidence.overall) {
    changes.push({ field: 'confidence.overall', code: 'confidence-clamped' });
  }
  return {
    ...plan,
    references: uniqueBy(plan.references, referenceKey, 'references', changes),
    unresolvedReferences: uniqueBy(
      plan.unresolvedReferences,
      unresolvedReferenceKey,
      'unresolvedReferences',
      changes,
    ),
    requiredContextSources: uniqueBy(
      plan.requiredContextSources,
      contextSourceKey,
      'requiredContextSources',
      changes,
    ),
    memoryReads: uniqueBy(plan.memoryReads, memoryReadKey, 'memoryReads', changes),
    memoryWrites: uniqueBy(plan.memoryWrites, memoryWriteKey, 'memoryWrites', changes),
    vision: {
      ...plan.vision,
      imageReferenceIds: uniqueStrings(plan.vision.imageReferenceIds),
      evidenceIds: uniqueStrings(plan.vision.evidenceIds),
    },
    confidence: {
      overall: confidence,
      unresolvedFields: uniqueStrings(plan.confidence.unresolvedFields),
    },
  };
}

function rejectUncertainDurableWrites(
  plan: TurnPlan,
  changes: TurnPlanValidationChange[],
): TurnPlan {
  const accepted = plan.memoryWrites.filter(isValidatedMemoryWrite);
  if (accepted.length === plan.memoryWrites.length) {
    return plan;
  }
  changes.push({
    field: 'memoryWrites',
    code: 'uncertain-durable-memory-write-removed',
  });
  return {
    ...plan,
    memoryWrites: accepted,
    generationTaskKind: 'clarification',
    fallback: 'clarify-reference',
  };
}

function enforceReferenceSafety(
  plan: TurnPlan,
  changes: TurnPlanValidationChange[],
): TurnPlan {
  const unresolvedImage = plan.unresolvedReferences.some(
    (reference) => reference.targetType === 'image',
  );
  if (unresolvedImage) {
    changes.push({
      field: 'vision',
      code: 'unresolved-image-selection-removed',
    });
    return {
      ...plan,
      references: plan.references.filter((reference) => reference.targetType !== 'image'),
      requiredContextSources: plan.requiredContextSources.filter(
        (source) => source.sourceType !== 'image',
      ),
      vision: noVision(),
      generationTaskKind: 'clarification',
      fallback: 'clarify-reference',
    };
  }

  if (plan.vision.strategy === 'none') {
    return plan;
  }

  if (plan.vision.imageReferenceIds.length === 0) {
    changes.push({ field: 'vision.imageReferenceIds', code: 'missing-image-fallback' });
    return {
      ...plan,
      vision: noVision(),
      generationTaskKind: 'clarification',
      fallback: 'asset-unavailable',
    };
  }

  const unavailableImage = plan.references.some(
    (reference) =>
      reference.targetType === 'image'
      && plan.vision.imageReferenceIds.includes(reference.targetId)
      && reference.assetAvailability !== undefined
      && reference.assetAvailability !== 'available',
  );
  if (!unavailableImage) {
    return plan;
  }
  if (plan.vision.strategy === 'compare-evidence') {
    return plan;
  }
  changes.push({ field: 'vision.imageReferenceIds', code: 'unavailable-image-fallback' });
  return {
    ...plan,
    vision: noVision(),
    generationTaskKind: 'clarification',
    fallback: 'asset-unavailable',
  };
}

function enforceProviderCapabilities(
  plan: TurnPlan,
  capabilities: TurnPlanProviderCapabilities,
  changes: TurnPlanValidationChange[],
): TurnPlan {
  if (plan.vision.strategy === 'none') {
    return plan;
  }
  if (!capabilities.supportsImageInput) {
    changes.push({ field: 'vision.strategy', code: 'image-capability-fallback' });
    return {
      ...plan,
      vision: noVision(),
      generationTaskKind: 'clarification',
      fallback: 'capability-unavailable',
    };
  }
  if (
    plan.vision.strategy === 'inspect-and-structure'
    && !capabilities.supportsStructuredExtraction
  ) {
    changes.push({
      field: 'vision.strategy',
      code: 'structured-extraction-capability-fallback',
    });
    return {
      ...plan,
      vision: noVision(),
      generationTaskKind: 'clarification',
      fallback: 'capability-unavailable',
    };
  }
  return plan;
}

function isValidatedMemoryWrite(write: MemoryWriteRequirement): boolean {
  if (write.scope === 'conversation') {
    return write.fact.verbatimText.trim() !== '';
  }
  return (
    write.explicitUserCommand
    && write.confidence >= 0.8
    && write.sourceMessageId.trim() !== ''
    && write.fact.subject.trim() !== ''
    && write.fact.predicate.trim() !== ''
    && write.fact.value.trim() !== ''
    && write.fact.verbatimText.trim() !== ''
  );
}

function noVision(): VisionExecutionPlan {
  return {
    strategy: 'none',
    imageReferenceIds: [],
    evidenceIds: [],
  };
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueBy<T>(
  values: readonly T[],
  key: (value: T) => string,
  field: string,
  changes: TurnPlanValidationChange[],
): T[] {
  const byKey = new Map<string, T>();
  for (const value of values) {
    byKey.set(key(value), value);
  }
  if (byKey.size !== values.length) {
    changes.push({ field, code: 'duplicate-entry-removed' });
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function referenceKey(value: ResolvedReference): string {
  return `${value.targetType}:${value.targetId}`;
}

function unresolvedReferenceKey(value: UnresolvedReference): string {
  return `${value.targetType}:${[...value.candidateIds].sort().join(',')}`;
}

function contextSourceKey(value: ContextSourceRequirement): string {
  return `${value.sourceType}:${value.sourceId}`;
}

function memoryReadKey(value: MemoryReadRequirement): string {
  return `${value.scope}:${value.memoryId}`;
}

function memoryWriteKey(value: MemoryWriteRequirement): string {
  return `${value.scope}:${value.memoryId}`;
}
