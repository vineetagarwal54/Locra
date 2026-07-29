import type {
  DeviceResourcePolicy,
  ResourceLease,
} from '../inference/DeviceResourcePolicy';

import type { TurnIntent } from './types';

export const CONSTRAINED_PLANNER_MAX_TOKENS = 96;
export const CONSTRAINED_PLANNER_TIMEOUT_MS = 8_000;
export const CONSTRAINED_PLANNER_CONFIDENCE_THRESHOLD = 0.8;

export type ConstrainedPlannerField =
  | 'reference'
  | 'intent'
  | 'memory-interpretation'
  | 'context-scope';

export type ConstrainedPlannerAction =
  | 'answer'
  | 'retry'
  | 'regenerate'
  | 'continue';

export interface ConstrainedPlannerGateInput {
  readonly unresolvedFields: readonly ConstrainedPlannerField[];
  readonly candidateReferenceIds: readonly string[];
  readonly materiallyPlausibleInterpretationCount: number;
  readonly ordinaryIndependentQuestion: boolean;
  readonly clearImageTurn: boolean;
  readonly explicitMemoryWrite: boolean;
  readonly explicitMemoryRecall: boolean;
  readonly action: ConstrainedPlannerAction;
}

export type ConstrainedPlannerGateReason =
  | 'multiple-material-interpretations'
  | 'no-unresolved-fields'
  | 'insufficient-material-ambiguity'
  | 'ordinary-independent-question'
  | 'clear-image-turn'
  | 'explicit-memory-write'
  | 'explicit-memory-recall'
  | 'explicit-turn-action';

export interface ConstrainedPlannerGate {
  readonly invoke: boolean;
  readonly reason: ConstrainedPlannerGateReason;
}

export type PlanningRationaleCode =
  | 'reference-language-match'
  | 'candidate-description-match'
  | 'recent-dependency-match'
  | 'ledger-entity-match'
  | 'memory-command-semantics'
  | 'memory-question-semantics'
  | 'context-scope-language'
  | 'insufficient-evidence';

export interface ConstrainedPlanningResolution {
  readonly candidateReferenceIdsReceived: readonly string[];
  readonly selectedReferenceIds: readonly string[];
  readonly referenceStatus: 'resolved' | 'unresolved';
  readonly intentClarification: TurnIntent | null;
  readonly memoryInterpretation: 'read' | 'write' | 'neither' | 'unresolved';
  readonly requestedContextScope:
    | 'current-turn'
    | 'recent'
    | 'same-chat'
    | 'cross-chat'
    | 'unresolved';
  readonly confidence: number;
  readonly rationaleCodes: readonly PlanningRationaleCode[];
  readonly clarificationRequired: boolean;
}

export interface ConstrainedPlannerRequest {
  readonly candidateReferenceIds: readonly string[];
  readonly unresolvedFields: readonly ConstrainedPlannerField[];
  readonly maxGeneratedTokens: number;
}

export interface ConstrainedPlannerModel {
  generateResolution(
    request: ConstrainedPlannerRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export type ConstrainedPlannerStatus =
  | 'not-invoked'
  | 'accepted'
  | 'rejected'
  | 'unavailable'
  | 'cancelled'
  | 'suspended'
  | 'timed-out';

export interface ConservativePlanningFallback {
  readonly clarificationRequired: boolean;
  readonly preserveAttachedImages: true;
  readonly preserveExplicitReferences: true;
  readonly preserveExactMemoryCandidates: true;
  readonly preserveCandidateReferenceIds: readonly string[];
  readonly useLexicalContextWhenSafe: true;
}

export interface ConstrainedPlannerDiagnostics {
  readonly invoked: boolean;
  readonly gateReason: ConstrainedPlannerGateReason;
  readonly queueWaitMs: number;
  readonly executionMs: number;
  readonly timeoutMs: number;
  readonly maxGeneratedTokens: number;
  readonly confidenceThreshold: number;
  readonly validationResult: string;
}

export interface ConstrainedPlannerResult {
  readonly status: ConstrainedPlannerStatus;
  readonly resolution: ConstrainedPlanningResolution | null;
  readonly fallback: ConservativePlanningFallback;
  readonly diagnostics: ConstrainedPlannerDiagnostics;
}

export interface RunConstrainedPlannerInput {
  readonly gate: ConstrainedPlannerGateInput;
  readonly model: ConstrainedPlannerModel | null;
  readonly resourcePolicy: DeviceResourcePolicy;
  readonly signal: AbortSignal;
  readonly cancellationKind?: 'cancelled' | 'suspended';
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

const RATIONALE_CODES = new Set<PlanningRationaleCode>([
  'reference-language-match',
  'candidate-description-match',
  'recent-dependency-match',
  'ledger-entity-match',
  'memory-command-semantics',
  'memory-question-semantics',
  'context-scope-language',
  'insufficient-evidence',
]);

const TURN_INTENTS = new Set<TurnIntent>([
  'answer',
  'compare',
  'transform',
  'recall',
  'remember',
  'inspect',
  'extract',
  'retry',
  'regenerate',
  'continue',
  'clarify',
]);

export function evaluateConstrainedPlannerGate(
  input: ConstrainedPlannerGateInput,
): ConstrainedPlannerGate {
  if (input.unresolvedFields.length === 0) {
    return { invoke: false, reason: 'no-unresolved-fields' };
  }
  if (input.ordinaryIndependentQuestion) {
    return { invoke: false, reason: 'ordinary-independent-question' };
  }
  if (input.clearImageTurn) {
    return { invoke: false, reason: 'clear-image-turn' };
  }
  if (input.explicitMemoryWrite) {
    return { invoke: false, reason: 'explicit-memory-write' };
  }
  if (input.explicitMemoryRecall) {
    return { invoke: false, reason: 'explicit-memory-recall' };
  }
  if (
    input.action === 'retry'
    || input.action === 'regenerate'
    || input.action === 'continue'
  ) {
    return { invoke: false, reason: 'explicit-turn-action' };
  }
  if (input.materiallyPlausibleInterpretationCount < 2) {
    return { invoke: false, reason: 'insufficient-material-ambiguity' };
  }
  return { invoke: true, reason: 'multiple-material-interpretations' };
}

export async function runConstrainedPlannerFallback(
  input: RunConstrainedPlannerInput,
): Promise<ConstrainedPlannerResult> {
  const gate = evaluateConstrainedPlannerGate(input.gate);
  const fallback = conservativeFallback(input.gate.candidateReferenceIds);
  const timeoutMs = input.timeoutMs ?? CONSTRAINED_PLANNER_TIMEOUT_MS;
  const now = input.now ?? Date.now;
  const baseDiagnostics = {
    gateReason: gate.reason,
    timeoutMs,
    maxGeneratedTokens: CONSTRAINED_PLANNER_MAX_TOKENS,
    confidenceThreshold: CONSTRAINED_PLANNER_CONFIDENCE_THRESHOLD,
  };
  if (!gate.invoke) {
    return {
      status: 'not-invoked',
      resolution: null,
      fallback,
      diagnostics: {
        ...baseDiagnostics,
        invoked: false,
        queueWaitMs: 0,
        executionMs: 0,
        validationResult: 'gate-closed',
      },
    };
  }
  if (input.model === null) {
    return {
      status: 'unavailable',
      resolution: null,
      fallback,
      diagnostics: {
        ...baseDiagnostics,
        invoked: true,
        queueWaitMs: 0,
        executionMs: 0,
        validationResult: 'model-unavailable',
      },
    };
  }
  if (input.signal.aborted) {
    return cancelledResult(input, fallback, baseDiagnostics);
  }

  const queueStarted = now();
  const lease = await acquireLeaseWithCancellation(input.resourcePolicy, input.signal);
  const queueWaitMs = Math.max(0, now() - queueStarted);
  if (lease === null) {
    return {
      ...cancelledResult(input, fallback, baseDiagnostics),
      diagnostics: {
        ...cancelledResult(input, fallback, baseDiagnostics).diagnostics,
        queueWaitMs,
      },
    };
  }

  const executionStarted = now();
  const executionController = new AbortController();
  const detachExternalAbort = forwardAbort(input.signal, executionController);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  try {
    const request: ConstrainedPlannerRequest = {
      candidateReferenceIds: [...input.gate.candidateReferenceIds],
      unresolvedFields: [...input.gate.unresolvedFields],
      maxGeneratedTokens: CONSTRAINED_PLANNER_MAX_TOKENS,
    };
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        executionController.abort('timeout');
        reject(new Error('constrained-planner-timeout'));
      }, timeoutMs);
    });
    const raw = await Promise.race([
      input.model.generateResolution(request, executionController.signal),
      timeoutPromise,
      abortPromise(executionController.signal),
    ]);
    const validation = validateResolution(raw, input.gate);
    const executionMs = Math.max(0, now() - executionStarted);
    if (validation.resolution === null) {
      return {
        status: 'rejected',
        resolution: null,
        fallback,
        diagnostics: {
          ...baseDiagnostics,
          invoked: true,
          queueWaitMs,
          executionMs,
          validationResult: validation.reason,
        },
      };
    }
    return {
      status: 'accepted',
      resolution: validation.resolution,
      fallback,
      diagnostics: {
        ...baseDiagnostics,
        invoked: true,
        queueWaitMs,
        executionMs,
        validationResult: 'accepted',
      },
    };
  } catch {
    const executionMs = Math.max(0, now() - executionStarted);
    const status: ConstrainedPlannerStatus = timedOut
      ? 'timed-out'
      : input.cancellationKind === 'suspended'
        ? 'suspended'
        : input.signal.aborted
          ? 'cancelled'
          : 'unavailable';
    return {
      status,
      resolution: null,
      fallback,
      diagnostics: {
        ...baseDiagnostics,
        invoked: true,
        queueWaitMs,
        executionMs,
        validationResult: status,
      },
    };
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
    detachExternalAbort();
    lease.release();
  }
}

function validateResolution(
  raw: unknown,
  gate: ConstrainedPlannerGateInput,
): { resolution: ConstrainedPlanningResolution | null; reason: string } {
  if (!isRecord(raw)) {
    return { resolution: null, reason: 'malformed-output' };
  }
  const candidateIdsReceived = stringArray(raw.candidateReferenceIdsReceived);
  const selectedIds = stringArray(raw.selectedReferenceIds);
  const rationaleCodes = stringArray(raw.rationaleCodes);
  if (
    candidateIdsReceived === null
    || selectedIds === null
    || rationaleCodes === null
    || !sameOrderedValues(candidateIdsReceived, gate.candidateReferenceIds)
  ) {
    return { resolution: null, reason: 'candidate-list-mismatch' };
  }
  const candidateSet = new Set(gate.candidateReferenceIds);
  if (selectedIds.some((id) => !candidateSet.has(id))) {
    return { resolution: null, reason: 'candidate-injection' };
  }
  if (
    (raw.referenceStatus !== 'resolved' && raw.referenceStatus !== 'unresolved')
    || !isNullableTurnIntent(raw.intentClarification)
    || !isMemoryInterpretation(raw.memoryInterpretation)
    || !isContextScope(raw.requestedContextScope)
    || typeof raw.confidence !== 'number'
    || !Number.isFinite(raw.confidence)
    || raw.confidence < 0
    || raw.confidence > 1
    || !rationaleCodes.every((code) => RATIONALE_CODES.has(code as PlanningRationaleCode))
    || typeof raw.clarificationRequired !== 'boolean'
  ) {
    return { resolution: null, reason: 'malformed-output' };
  }
  if (raw.confidence < CONSTRAINED_PLANNER_CONFIDENCE_THRESHOLD) {
    return { resolution: null, reason: 'low-confidence' };
  }
  if (
    raw.referenceStatus === 'resolved'
    && gate.unresolvedFields.includes('reference')
    && selectedIds.length === 0
  ) {
    return { resolution: null, reason: 'resolved-without-selection' };
  }
  if (
    raw.referenceStatus === 'unresolved'
    && selectedIds.length > 0
  ) {
    return { resolution: null, reason: 'unresolved-with-selection' };
  }

  return {
    resolution: {
      candidateReferenceIdsReceived: candidateIdsReceived,
      selectedReferenceIds: selectedIds,
      referenceStatus: raw.referenceStatus,
      intentClarification: raw.intentClarification,
      memoryInterpretation: raw.memoryInterpretation,
      requestedContextScope: raw.requestedContextScope,
      confidence: raw.confidence,
      rationaleCodes: rationaleCodes as PlanningRationaleCode[],
      clarificationRequired: raw.clarificationRequired,
    },
    reason: 'accepted',
  };
}

function conservativeFallback(
  candidateIds: readonly string[],
): ConservativePlanningFallback {
  return {
    clarificationRequired: true,
    preserveAttachedImages: true,
    preserveExplicitReferences: true,
    preserveExactMemoryCandidates: true,
    preserveCandidateReferenceIds: [...candidateIds],
    useLexicalContextWhenSafe: true,
  };
}

function cancelledResult(
  input: RunConstrainedPlannerInput,
  fallback: ConservativePlanningFallback,
  baseDiagnostics: {
    readonly gateReason: ConstrainedPlannerGateReason;
    readonly timeoutMs: number;
    readonly maxGeneratedTokens: number;
    readonly confidenceThreshold: number;
  },
): ConstrainedPlannerResult {
  const status = input.cancellationKind === 'suspended' ? 'suspended' : 'cancelled';
  return {
    status,
    resolution: null,
    fallback,
    diagnostics: {
      ...baseDiagnostics,
      invoked: true,
      queueWaitMs: 0,
      executionMs: 0,
      validationResult: status,
    },
  };
}

async function acquireLeaseWithCancellation(
  policy: DeviceResourcePolicy,
  signal: AbortSignal,
): Promise<ResourceLease | null> {
  const leasePromise = policy.acquire('qwen-answer');
  if (signal.aborted) {
    void leasePromise.then((lease) => lease.release());
    return null;
  }
  return new Promise<ResourceLease | null>((resolve) => {
    let settled = false;
    function finish(lease: ResourceLease | null): void {
      if (settled) {
        lease?.release();
        return;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(lease);
    }
    function onAbort(): void {
      finish(null);
    }
    signal.addEventListener('abort', onAbort, { once: true });
    void leasePromise.then(finish);
  });
}

function forwardAbort(source: AbortSignal, target: AbortController): () => void {
  function onAbort(): void {
    target.abort(source.reason);
  }
  if (source.aborted) {
    onAbort();
    return () => undefined;
  }
  source.addEventListener('abort', onAbort, { once: true });
  return () => source.removeEventListener('abort', onAbort);
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('constrained-planner-aborted'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => reject(new Error('constrained-planner-aborted')),
      { once: true },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return null;
  }
  return value as string[];
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isNullableTurnIntent(value: unknown): value is TurnIntent | null {
  return value === null || (typeof value === 'string' && TURN_INTENTS.has(value as TurnIntent));
}

function isMemoryInterpretation(
  value: unknown,
): value is ConstrainedPlanningResolution['memoryInterpretation'] {
  return (
    value === 'read'
    || value === 'write'
    || value === 'neither'
    || value === 'unresolved'
  );
}

function isContextScope(
  value: unknown,
): value is ConstrainedPlanningResolution['requestedContextScope'] {
  return (
    value === 'current-turn'
    || value === 'recent'
    || value === 'same-chat'
    || value === 'cross-chat'
    || value === 'unresolved'
  );
}
