export type IndependentRecoveryKind =
  | 'explicit-memory'
  | 'same-chat-lexical'
  | 'direct-entity'
  | 'attached-image'
  | 'explicit-image-reference'
  | 'user-fact'
  | 'active-comparison-target';

export interface IndependentRecoveryCandidate {
  readonly id: string;
  readonly kind: IndependentRecoveryKind;
  readonly sourceMessageId: string;
  readonly content: string | null;
  readonly exactOrDirect: boolean;
  readonly ambiguous?: boolean;
}

export interface IndependentRoutingRecoveryInput {
  readonly enabled: boolean;
  readonly classifiedIndependent: boolean;
  readonly candidates: readonly IndependentRecoveryCandidate[];
}

export interface IndependentRoutingRecoveryResult {
  readonly enabled: boolean;
  readonly classifiedIndependent: boolean;
  readonly considered: number;
  readonly recovered: readonly IndependentRecoveryCandidate[];
}

export function recoverIndependentRoutingSources(
  input: IndependentRoutingRecoveryInput,
): IndependentRoutingRecoveryResult {
  if (!input.enabled || !input.classifiedIndependent) {
    return {
      enabled: input.enabled,
      classifiedIndependent: input.classifiedIndependent,
      considered: 0,
      recovered: [],
    };
  }

  const recoveredById = new Map<string, IndependentRecoveryCandidate>();
  for (const candidate of input.candidates) {
    if (!candidate.exactOrDirect || candidate.ambiguous === true) {
      continue;
    }
    recoveredById.set(candidate.id, candidate);
  }

  return {
    enabled: true,
    classifiedIndependent: true,
    considered: input.candidates.length,
    recovered: [...recoveredById.values()].sort(compareCandidates),
  };
}

function compareCandidates(
  left: IndependentRecoveryCandidate,
  right: IndependentRecoveryCandidate,
): number {
  return left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind);
}
