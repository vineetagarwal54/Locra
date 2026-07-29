# Contract: Unified Turn Planning

`TurnPlan` is the sole semantic decision for a turn.
`RequestClassification` may remain only as a legacy/shadow adapter. Context
assembly, generation planning, vision, `InferenceQueue`, refusal recovery, and
grounding execute the validated plan and do not reclassify it.

## TurnPlan MVP (Wave A)

```ts
type AuthorityMode = 'shadow' | 'controlled' | 'authoritative';
type TurnIntent =
  | 'answer' | 'compare' | 'transform' | 'recall' | 'remember'
  | 'inspect' | 'extract' | 'retry' | 'regenerate' | 'continue' | 'clarify';
type TurnModality = 'text' | 'image' | 'multimodal';
type ConversationDependency =
  | 'none' | 'recent' | 'ledger' | 'retrieval' | 'mixed' | 'unresolved';
type GenerationTaskKind =
  | 'answer' | 'comparison' | 'extraction' | 'clarification'
  | 'continuation' | 'refusal-recovery';
type SafeFallback =
  | 'execute' | 'clarify-reference' | 'lexical-only'
  | 'asset-unavailable' | 'capability-unavailable' | 'cancelled';

interface TurnPlan {
  readonly planVersion: string;
  readonly turnId: string;
  readonly authorityMode: AuthorityMode;
  readonly planOwner: string;
  readonly intent: TurnIntent;
  readonly modality: TurnModality;
  readonly conversationDependency: ConversationDependency;
  readonly references: readonly ResolvedReference[];
  readonly unresolvedReferences: readonly UnresolvedReference[];
  readonly requiredContextSources: readonly ContextSourceRequirement[];
  readonly memoryReads: readonly MemoryReadRequirement[];
  readonly memoryWrites: readonly MemoryWriteRequirement[];
  readonly vision: VisionExecutionPlan;
  readonly generationTaskKind: GenerationTaskKind;
  readonly confidence: PlanningConfidence;
  readonly fallback: SafeFallback;
}
```

Each resolved reference includes target type/ID, bounded resolution code,
confidence, and source provenance. Each unresolved reference includes the
deterministically ordered candidate IDs, reason, and
`clarificationRequired`. It has no selected target.

Context-source requirements identify source type, stable source/candidate IDs
when known, `required | optional`, bounded reason code, and provenance. Memory
reads identify query/scope/required status. Memory writes contain explicit
user-command status, validated factual payload, scope, and source message; an
uncertain durable write is invalid.

Optional later enrichment may add active topic/entity snapshots, retrieval
ranking hints, output-format detail, and planning-signal diagnostics. These
fields do not delay Wave A and never become a second semantic authority.

## Authority modes

- `shadow`: `planOwner` is the versioned legacy router. Legacy routing executes
  the complete turn. The new planner changes no visible behavior, context/image
  selection, memory write, or inference execution; its diagnostics are separate.
  A live Tier-3 model call is not inserted into the shadow turn path; diagnostics
  record `wouldInvoke`, while mocked/explicit validation exercises Tier 3
  separately.
- `controlled`: an explicitly named scenario class or feature-gated turn type
  assigns `planOwner` to the new planner. For a controlled image-related class,
  that plan owns reference resolution, image selection, context-source
  selection, context assembly, vision strategy, generation-task projection, and
  inference execution for the complete turn. Legacy semantic routing is bypassed
  for the entire turn and is available only as a full-turn rollback.
- `authoritative`: the new planner owns every supported turn. Legacy semantic
  routing is not consulted; temporarily retained code is only a full-turn
  rollback gate until physical acceptance.

**Invariant:** no single turn may be executed by two semantic authorities. New
vision with legacy context/generation, or any equivalent mixture, is invalid.

## Planning tiers

1. Deterministic application state: attachments, assets, conversation identity,
   action type, settings, feature gates, and provider readiness.
2. Ledger/recent dependency, exact and lexical evidence, active topic/entity
   signals, and optional embedding signals when an approved index is ready.
3. Constrained model resolution only under the gate below.
4. Deterministic schema/capability/asset validation and conservative fallback.

Embedding similarity is additive. When embeddings are unavailable, lexical-only
topic/entity matching uses ledger identities, canonical labels, known aliases,
exact lexical matches, code identifiers, direct references, and active
comparison state. Planner authority must work with deterministic state, the
ledger, recent dependency, exact/lexical retrieval, explicit memories,
deterministic reference resolution, and permitted Tier 3 while the embedding
provider is unavailable. This does not introduce semantic regex routing.
Lexical-only is a supported authoritative mode.

## Constrained unresolved-field resolution

Tier 3 receives the complete deterministic candidate-ID list and an explicit list
of unresolved fields. It returns only:

```ts
interface ConstrainedPlanningResolution {
  readonly candidateReferenceIdsReceived: readonly string[];
  readonly selectedReferenceIds: readonly string[];
  readonly referenceStatus: 'resolved' | 'unresolved';
  readonly intentClarification: TurnIntent | null;
  readonly memoryInterpretation: 'read' | 'write' | 'neither' | 'unresolved';
  readonly requestedContextScope:
    | 'current-turn' | 'recent' | 'same-chat' | 'cross-chat' | 'unresolved';
  readonly confidence: number;
  readonly rationaleCodes: readonly PlanningRationaleCode[];
  readonly clarificationRequired: boolean;
}

type PlanningRationaleCode =
  | 'reference-language-match'
  | 'candidate-description-match'
  | 'recent-dependency-match'
  | 'ledger-entity-match'
  | 'memory-command-semantics'
  | 'memory-question-semantics'
  | 'context-scope-language'
  | 'insufficient-evidence';
```

The model cannot add a candidate ID, rewrite a resolved field, or output free-form
rationale as authority. It may initially run through the current Qwen provider.

### Deterministic invocation gate

Tier 3 may run only after deterministic state, ledger state, exact/lexical
evidence, and deterministic reference resolution leave at least two materially
plausible interpretations whose difference changes image target, memory
operation, context scope, or answer task.

It does not run for ordinary independent questions, clear image turns, explicit
memory writes, explicit memory recalls, retry, regenerate, or continuation.

### Runtime and fallback

- Runs serially before answer generation under the existing single-flight
  device-resource policy.
- Uses at most 96 generated tokens and an 8-second execution timeout after lease
  acquisition; queue wait and execution latency are diagnosed separately from
  normal context assembly.
- Supports cancellation and app suspension and releases its lease cleanly.
- Acceptance requires deterministic schema/candidate validation and confidence
  `>= 0.80`.
- Unavailable, cancelled, suspended, timed-out, malformed, candidate-injecting,
  or low-confidence output preserves current input, attachments, direct
  references, and exact memory candidates; uses lexical-only context when safe;
  leaves ambiguous image references unresolved; requests clarification; and
  never creates an uncertain durable memory.
- Tier 3 never silently removes an attachment, explicit reference, or exact
  memory candidate.

## Determinism boundary and tests

Application/ledger evaluation, exact/lexical retrieval, candidate construction
and ordering, invocation gating, validation, and fallback are deterministic for
identical versioned inputs. Model output bytes are not guaranteed deterministic;
schema validation and post-processing are.

Golden scenarios must resolve without Tier 3 and assert it was not invoked.
Separate bounded contract tests use mocked outputs for valid resolution,
cancellation, timeout, suspension, malformed output, candidate injection, and
low confidence.

## Reference and safety rules

- A pixel-requiring plan identifies one available image or remains unresolved/
  asset-unavailable. It never silently becomes text-only.
- Multiple materially plausible image targets produce `unresolved-reference`
  and clarification. No image, pixels, or evidence is presented as the requested
  target until resolution succeeds.
- The active image may resolve only when semantics point to the active visual
  entity and no other candidate is materially plausible.
- Low confidence in one field does not erase unrelated established
  requirements.
- Continue/retry/regenerate semantics link to the prior plan/attempt.
- Regex is limited to deterministic syntax (ordinals, identifiers, paths, dates,
  code identifiers) and structured-output validation, not semantic authority.

## Diagnostics

Every turn records authority mode, exact plan owner, plan/version, tiers used,
whether Tier 3 was invoked, gate/result/fallback, confidence, provenance,
validation changes, execution outcome, and legacy/new delta when applicable.
Exports remain sanitized and exclude prompts, raw model identifiers, and hidden
reasoning.
