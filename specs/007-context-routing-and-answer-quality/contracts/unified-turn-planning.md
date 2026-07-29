# Contract: Unified Turn Planning

This contract supersedes `RequestClassification` as the authoritative semantic
decision for a turn. `RequestClassification` may remain temporarily as a legacy
shadow-mode adapter, but downstream modules consume one validated `TurnPlan` and
MUST NOT independently reinterpret the request.

## TurnPlan

```ts
interface TurnPlan {
  readonly planVersion: string;
  readonly turnId: string;
  readonly intent: TurnIntent;
  readonly modality: 'text' | 'image' | 'multimodal';
  readonly conversationDependency: ConversationDependency;
  readonly references: readonly ResolvedReference[];
  readonly unresolvedReferences: readonly UnresolvedReference[];
  readonly activeEntityIds: readonly string[];
  readonly activeTopics: readonly TopicReference[];
  readonly memoryReads: readonly MemoryRead[];
  readonly memoryWrites: readonly MemoryWrite[];
  readonly retrievalScope: RetrievalScope;
  readonly vision: VisionExecutionPlan;
  readonly requiredContextSources: readonly ContextSourceRequirement[];
  readonly generation: GenerationRequirements;
  readonly confidence: PlanningConfidence;
  readonly fallback: SafeFallbackPlan;
  readonly evidence: readonly PlanningSignal[];
}
```

The exact TypeScript names may change during implementation, but the semantic
fields and single-authority invariant may not.

## Planning tiers

Planning evaluates signals in this order:

1. **Deterministic application state**: current attachment, available prior image
   assets, active conversation, continue/retry/regenerate action, feature
   settings, and artifact/runtime readiness.
2. **Semantic signals**: query/topic/entity embedding similarity, eligible
   retrieval evidence, ledger state, and recent dependency state.
3. **Constrained model fallback**: only for unresolved ambiguity after tiers 1
   and 2; produces a validated structured plan. The current Qwen model may
   initially provide this capability, but no final-answer generation is required
   for unambiguous requests.
4. **Deterministic validation and safe fallback**: rejects impossible or unsafe
   plans, preserves independently required sources, and emits an explicit
   fallback or clarification requirement.

## Single-authority invariant

After validation, these consumers execute the plan without making a second
semantic decision:

- context orchestration and context ranking;
- generation planning and prompt construction;
- vision execution and image-evidence persistence;
- `InferenceQueue` dispatch;
- refusal recovery and reinspection;
- grounding assessment and diagnostics.

Request classification, context orchestration, generation planning, vision
execution, the inference queue, refusal recovery, and grounding assessment MUST
NOT each infer their own intent, modality, dependency, image target, or retrieval
requirement. A downstream module may validate a required capability or asset and
report an execution result, but it may not silently replace the plan.

## Regex boundary

Regex is permitted for deterministic syntax and validation, including explicit
ordinals, identifiers, file paths, dates, code identifiers, and
structured-output validation. Regex MUST NOT be the primary authority for
semantic intent, conversation dependency, memory recall, active-topic
selection, or image-reference understanding.

## Validation and fallback

- A plan requiring image pixels MUST identify one available image entity or
  remain explicitly unresolved. It MUST NOT degrade silently to text-only.
- An ambiguous reference to multiple plausible images MUST NOT be guessed or
  silently mapped to the active image. The plan requests clarification or uses
  only evidence that is valid for every plausible target.
- Low confidence in one semantic field MUST NOT erase unrelated, independently
  established context requirements. For example, uncertainty about intent does
  not remove an explicitly attached image or an explicit durable-memory write.
- Unsupported provider capabilities, missing assets, cancellation, validation
  failure, or planner failure produce a deterministic safe fallback and clean UI
  state; none may crash or bypass the single-flight inference queue.
- Continue, retry, and regenerate actions reuse or revise the prior validated
  plan according to explicit action semantics; they do not reclassify the turn
  independently in the queue.

## Diagnostics

Shadow and authoritative modes record the validated plan, planning tier used,
signal provenance, field-level confidence, validation changes, legacy/new-plan
differences, execution outcomes, and fallback reasons. User-facing exports
remain sanitized and do not expose internal prompts, raw model identifiers, or
hidden reasoning.
