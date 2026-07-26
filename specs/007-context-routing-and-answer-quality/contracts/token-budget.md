# Contract: Token-Aware Context Budgeting

**Module**: new token-based `ContextBudgetPolicy` implementation in `src/inference/ContextOrchestrator.ts` (replacing `CharacterContextBudgetPolicy` as the runtime default) + extended `src/inference/ContextWindow.ts`

## Pinned constants (versioned; change only via recorded evaluation)

- Token-equivalent measurement ratio starts from `ContextWindow.estimateMessageTokens`'s existing `Math.ceil(length / 3)` approximation (research.md §1); exact final ratio is calibrated in Phase 4 and may be revised by recorded evaluation only.
- `QWEN_CONTEXT_TOKEN_LIMIT = 4096` (unchanged, `ResponseMode.ts`).
- Response-mode budgets are re-expressed in tokens (starting point derived from the existing character budgets — 4,000/7,000/11,000 chars — divided by the calibration ratio); final numbers are an Open Question pending evaluation (spec Section 13).

## ContextBudgetPolicy (interface unchanged, implementation replaced)

```ts
export interface ContextBudgetPolicy {
  readonly policyId: string;               // 'token-estimate-budget-v1'
  readonly maximumUnits: number;           // now tokens, not characters
  readonly recentExactTurnLimit: number;
  readonly maxMediaEvidenceItems: number;
  readonly maxFactItems: number;
  readonly maxSummaryEntries: number;
  measure(content: string): number;        // now a token estimate, not content.length
}
```

- **MUST** implement the same interface `ContextOrchestrator` already selects/evicts against — no change to orchestrator selection/eviction algorithms, only to what `measure()` returns and what `maximumUnits` means (spec FR-026).
- **MUST NOT** call `llama.rn`'s native `tokenize()` synchronously in the per-candidate selection hot path (research.md §1); `measure()` remains a pure, synchronous, in-process function.

## Reconciliation with ContextWindow (new requirement)

- The router's `maximumUnits` for a given response mode **MUST** be derived from (or kept ≤) the same real constraint `ContextWindow.trimMessagesToContextWithReport` already enforces: `QWEN_CONTEXT_TOKEN_LIMIT - getResponseGenerationLimit(mode) - CONTEXT_SAFETY_TOKENS`, so the router never selects a source set that the downstream hard trim would still need to silently cut (spec FR-027).
- A single shared calculation (or a shared constant) **MUST** back both the router's budget and `ContextWindow`'s trim so they cannot drift independently in the future.

## Protected sources and eviction order (unchanged behavior, now token-denominated)

- Current request text and any explicitly referenced or active image evidence are **never** evicted for any other source (spec FR-028).
- When assembled context exceeds the token budget, eviction order is: cross-chat retrieved items → same-chat retrieved items → durable facts → older-range summary entries → (recent-turn floor / current request / protected image evidence are never reached) (spec FR-030) — same ordering as Spec 006, now measured in tokens.

## Invariants

- `measure()` output for identical input is deterministic and stable across calls (spec FR-006).
- Per-mode budgets remain monotonic (Low < Medium < High) after recalibration to tokens, mirroring the existing monotonic character-based constraint from Spec 006.
