# Contract: Router Diagnostics (Phase 1, ships before behavior changes)

> **Architecture revision (2026-07-28)**: Diagnostics compare legacy routing
> with proposed/validated `TurnPlan` during shadow rollout. Legacy fields remain
> readable for historical records.

**Module**: extended `src/inference/ContextOrchestrator.ts` (`ContextSelectionDiagnostics`), `src/diagnostics/DiagnosticsBundleBuilder.ts`, `src/diagnostics/DiagnosticsTraceStore.ts`

## ContextSelectionDiagnostics (extended)

```ts
export interface ContextSelectionDiagnostics {
  // existing fields unchanged: recentTurnsConsidered, recentTurnsSelected,
  // mediaEvidenceCandidates, factCandidates, summaryCandidates, budget
  readonly classification: RequestClassification;             // NEW
  readonly retrievalMode: 'fused' | 'lexical-fallback' | 'none'; // NEW
  readonly retrievalModeReason: string;                         // NEW, actual reason, e.g. 'semantic-inactive-no-candidate'
  readonly retrievalQueried: boolean;                           // NEW — actual runtime call state
  readonly retrievalCandidatesReturned: number;                // NEW — actual retriever output count
  readonly retrievalItemsSelected: number;                     // NEW — actual selected retrieval count
  readonly actualSources: {                                    // NEW — actual current implementation
    readonly recentTurns: { readonly queried: boolean; readonly selected: number };
    readonly imageEvidence: { readonly queried: boolean; readonly selected: number };
    readonly retrieval: { readonly queried: boolean; readonly selected: number };
    readonly durableFacts: { readonly queried: boolean; readonly selected: number };
    readonly summary: { readonly queried: boolean; readonly selected: number };
  };
  readonly proposedRouting: {                                  // NEW — recorded Phase 3 prediction
    readonly wouldSkipRetrieval: boolean;
    readonly reason: string;
  };
  readonly imageDecision: ImageEvidenceDecision | 'not-applicable'; // NEW
  readonly imageReferenceAmbiguous: boolean;                    // NEW, spec FR-012a
  readonly imageReferenceResolution: 'not-applicable' | 'new-image' | 'active-image' | 'explicit-ordinal' | 'unique-description' | 'ambiguous-active-fallback';
  readonly crossChatActive: boolean;                            // NEW, actual per-turn scope use
  readonly crossChatQueried: boolean;                           // expanded scope actually queried
  readonly crossChatItemsSelected: number;                     // selected items from another chat
  readonly estimatedPromptTokens: number | null;               // tier-1 final-prompt estimate
  readonly finalNativePromptTokens: number | null;             // verified formatted prompt count
  readonly groundingVerdict: 'supported' | 'unsupported' | null; // NEW, diagnostics-only; null when not applicable
}
```

- **MUST** ship in Phase 1, before any routing *behavior* change lands, so classification and would-be source selection are observable against today's fixed-assembly behavior for comparison (spec Section 10 intro, Section 14 Phase 1).
- **MUST** keep Phase 1 observation-only: `retrievalMode`, `retrievalModeReason`, `retrievalQueried`, and the returned/selected counts describe what the current runtime actually queried and selected. They MUST NOT claim `independent-question-skip` while retrieval still ran.
- **MUST** retain `proposedRouting` as a distinct prediction field; actual runtime
  query and selection behavior is always reported by the retrieval/source fields.
- **MUST** record `imageDecision` even when the answer is `'not-applicable'`.
- **MUST** record `imageReferenceAmbiguous: true` whenever an image reference was defaulted to the active image per FR-012a, so the ambiguous-reference default is always disclosed, never silent.
- **MUST** set `groundingVerdict` only from the deterministic Phase 8 assessment;
  use selected context plus the current turn's fresh `hiddenEvidence`, and use
  `null` only when no image/retrieved evidence makes assessment applicable.
  Older pre-Phase-8 records may omit it without being considered incomplete.

## TurnPlan diagnostic extension

Each shadow or authoritative turn records:

- plan/schema version and planner mode (`shadow`, `controlled`,
  `authoritative`, `legacy-rollback`);
- sanitized validated `TurnPlan`;
- planning tiers/signals used and field-level confidence;
- unresolved references and safe fallback;
- deterministic validation changes/rejections;
- legacy classification/selection summary and material differences;
- execution outcomes for memory, retrieval, vision, context assembly, provider
  capability, generation, and queue completion;
- embedding provider/index descriptor and lexical fallback reason;
- selected source IDs/revisions and reliability.

Diagnostics distinguish planning decisions from execution failures. They remain
sanitized, exclude raw pixels/internal prompts by default, and do not expose
hidden reasoning or unredacted local paths.

## DiagnosticsBundleBuilder / DiagnosticsExportService (extended)

- **MUST** continue to sanitize local paths, exclude images by default, and disclose included conversation content exactly as today (Spec 006 FR-A06), extended to cover cross-chat conversation identifiers once Phase 7 ships (spec FR-038).
- **MUST** remain exportable from persistence repositories, not bounded UI caches, so router decisions on evicted/older turns stay inspectable (spec FR-039) — unchanged principle from Spec 006.

## Invariants

- Every turn processed by `ContextOrchestrator` produces one
  `ContextSelectionDiagnostics` record with all fields populated. Historical
  observation-only Phase 1 records may show sources queried/selected for an
  independent question; `proposedRouting` remains distinct from those actuals.
- Diagnostics are additive: no existing field is removed or repurposed; existing consumers of `ContextSelectionDiagnostics` (e.g., `ContextBuilder.ts`'s use of `formatMediaEvidence`/`formatMemoryFact`) continue to compile against the extended type.
