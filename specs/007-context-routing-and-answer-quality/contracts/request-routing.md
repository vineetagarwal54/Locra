# Contract: Request Routing (Classification + Minimal-Context Selection)

**Module**: new `src/inference/RequestClassifier.ts` + extended `src/inference/ContextOrchestrator.ts` | Consumers: `store/conversationStore.ts`

## RequestClassifier (new, pure functions, no I/O)

```ts
export interface RequestClassification {
  readonly isIndependentTextQuestion: boolean;
  readonly isTextFollowUp: boolean;
  readonly isNewImageQuestion: boolean;
  readonly isSameImageFollowUp: boolean;
  readonly isOlderImageReference: boolean;
  readonly isPixelDependent: boolean;
  readonly isLongContextRetrievalRequest: boolean;
  readonly isCrossChatEligible: boolean;
  readonly referencedImageId: string | null;
  readonly imageReferenceAmbiguous: boolean; // true => isSameImageFollowUp is forced true, isOlderImageReference forced false (spec FR-012a)
}

export function classifyRequest(
  snapshot: CanonicalConversationSnapshot,
  responseMode: ResponseMode,
  crossChatSettings: { enabled: boolean; conversationExcluded: boolean }, // always {enabled:false, conversationExcluded:false} before Phase 7
): RequestClassification;
```

- **MUST** be synchronous, deterministic, and free of network/model calls (spec FR-002).
- **MUST** default an ambiguous short reply (no explicit reference word, no independent clause) to `isTextFollowUp = true`, never `isIndependentTextQuestion = true` (spec edge case, conservative default).
- **MUST NOT** treat length alone as dependency. Standalone imperatives and fragments such as `Define entropy`, `Java vs Kotlin?`, and `Convert 5 miles` are independent unless they contain a real conversational reference. Elliptical references such as `And then?`, `Why is that?`, and `The second one?` remain follow-ups.
- **MUST** allow multiple flags to be true simultaneously (e.g. `isOlderImageReference && isPixelDependent`); flags are independent booleans, not one exclusive enum, except `isIndependentTextQuestion`/`isTextFollowUp` which are mutually exclusive with each other.

## ContextOrchestrator (extended)

```ts
orchestrate(
  snapshot: CanonicalConversationSnapshot,
  options: ContextOrchestrationOptions, // unchanged shape
): ContextOrchestrationResult; // unchanged shape; diagnostics gain classification/retrievalMode/imageDecision/crossChatActive fields
```

- **MUST** call `classifyRequest` first and gate all downstream source resolution on the result:
  - `isIndependentTextQuestion` (and no other classification independently requiring a source) → skip recent-turn inclusion beyond the bare current request, skip media-evidence resolution, skip same-chat/cross-chat retrieval, skip fact/summary resolution entirely (spec FR-003). This is a **hard skip**, not "resolve then discard" — the retriever, evidence repository, and fact/summary sources MUST NOT even be queried for a pure independent-question turn.
  - `isTextFollowUp`, any image classification, or `isLongContextRetrievalRequest` → existing Spec 006 priority order applies (current request → recent turns → image evidence → same-chat retrieval → facts → summary), scoped to whichever sources the active classification combination actually requires.
- **MUST** remain deterministic: identical `snapshot`, `options`, and settings state produce identical `RequestClassification` and identical selected/ordered context (spec FR-006).

## Invariants

- Recent exact turns are never displaced by retrieval, for any classification that includes them (spec FR-004) — unchanged from Spec 006. A pure independent-text-question classification has no recent-turn floor at all (FR-003/FR-004); this is a deliberate change from Spec 006's unconditional floor — see spec Superseded Requirements.
- Retrieval (lexical, semantic, or cross-chat) is added only when at least one candidate clears the existing relevance threshold; no filler on an empty result (spec FR-005) — unchanged from Spec 006.
- Diagnostics record the classification and which of the eight sources were *considered* vs. *selected* for every turn, including independent-question turns where the answer is "considered: none" (spec FR-037, see `diagnostics.md`).
