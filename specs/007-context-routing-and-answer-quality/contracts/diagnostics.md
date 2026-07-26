# Contract: Router Diagnostics (Phase 1, ships before behavior changes)

**Module**: extended `src/inference/ContextOrchestrator.ts` (`ContextSelectionDiagnostics`), `src/diagnostics/DiagnosticsBundleBuilder.ts`, `src/diagnostics/DiagnosticsTraceStore.ts`

## ContextSelectionDiagnostics (extended)

```ts
export interface ContextSelectionDiagnostics {
  // existing fields unchanged: recentTurnsConsidered, recentTurnsSelected,
  // mediaEvidenceCandidates, factCandidates, summaryCandidates, budget
  readonly classification: RequestClassification;             // NEW
  readonly retrievalMode: 'fused' | 'lexical-fallback' | 'none'; // NEW
  readonly retrievalModeReason: string;                         // NEW, e.g. 'embeddings-stale', 'below-threshold', 'independent-question-skip'
  readonly imageDecision: ImageEvidenceDecision | 'not-applicable'; // NEW
  readonly imageReferenceAmbiguous: boolean;                    // NEW, spec FR-012a
  readonly crossChatActive: boolean;                            // NEW, always false before Phase 7
  readonly groundingVerdict: 'supported' | 'unsupported' | null; // NEW, Phase 8 only; omit/null until shipped
}
```

- **MUST** ship in Phase 1, before any routing *behavior* change lands, so classification and would-be source selection are observable against today's fixed-assembly behavior for comparison (spec Section 10 intro, Section 14 Phase 1).
- **MUST** record `retrievalMode`/`imageDecision` even when the answer is `'none'`/`'not-applicable'` — diagnostics reflect what was *considered*, not only what was *selected* (spec FR-037).
- **MUST** record `imageReferenceAmbiguous: true` whenever an image reference was defaulted to the active image per FR-012a, so the ambiguous-reference default is always disclosed, never silent.
- **MUST** leave `groundingVerdict` omittable/`null` until Phase 8 ships without diagnostics being considered incomplete (spec FR-040).

## DiagnosticsBundleBuilder / DiagnosticsExportService (extended)

- **MUST** continue to sanitize local paths, exclude images by default, and disclose included conversation content exactly as today (Spec 006 FR-A06), extended to cover cross-chat conversation identifiers once Phase 7 ships (spec FR-038).
- **MUST** remain exportable from persistence repositories, not bounded UI caches, so router decisions on evicted/older turns stay inspectable (spec FR-039) — unchanged principle from Spec 006.

## Invariants

- Every turn processed by `ContextOrchestrator` after Phase 1 ships produces one `ContextSelectionDiagnostics` record with all NEW fields populated (except `groundingVerdict` pre-Phase-8) — no silent omission for "uninteresting" turns (e.g., independent questions still get a record showing zero sources considered).
- Diagnostics are additive: no existing field is removed or repurposed; existing consumers of `ContextSelectionDiagnostics` (e.g., `ContextBuilder.ts`'s use of `formatMediaEvidence`/`formatMemoryFact`) continue to compile against the extended type.
