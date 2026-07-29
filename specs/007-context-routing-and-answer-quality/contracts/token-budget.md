# Contract: Token-Aware Context Budgeting

> **Architecture revision (2026-07-28)**: Budgeting protects `TurnPlan` required
> sources and verifies with the active `MainInferenceProvider` tokenizer. Qwen
> constants below describe the current provider, not permanent architecture.

**Module**: new token-based `ContextBudgetPolicy` implementation in `src/inference/ContextOrchestrator.ts` (replacing `CharacterContextBudgetPolicy` as the runtime default) + extended `src/inference/ContextWindow.ts`

## Pinned constants (versioned; change only via recorded evaluation)

- Token-equivalent measurement ratio for tier-1 estimation starts from `ContextWindow.estimateMessageTokens`'s existing `Math.ceil(length / 3)` approximation (research.md §1); exact final ratio is calibrated in Phase 4 using real `tokenize()` output offline, and may be revised by recorded evaluation only.
- `QWEN_CONTEXT_TOKEN_LIMIT = 4096` (unchanged, `ResponseMode.ts`).
- Response-mode budgets are re-expressed in tokens as the **selected-context-pool bucket only** (starting point derived from the existing character budgets — 4,000/7,000/11,000 chars — divided by the calibration ratio); final numbers are an Open Question pending evaluation (spec Section 13).

## Two-tier measurement (spec FR-026b)

1. **Tier 1 — iterative selection**: `ContextBudgetPolicy.measure()` (below) uses the calibrated estimator. Called many times per request (once per candidate turn/fact/summary-entry/retrieved-item); MUST stay synchronous and MUST NOT call `llama.rn`'s native `tokenize()`.
2. **Tier 2 — bounded final reconciliation**: format and tokenize the actual Qwen prompt on the inference context the request already needs. If over limit, remove eligible context in the documented order and format/tokenize the reduced prompt again. If only system plus current input remains over limit, shorten the current input using measured native excess, preserving its beginning, end, visible marker, and any image media path. A small explicit maximum pass count guarantees termination; failure to prove a fit prevents completion.

## Reserved capacity buckets (spec FR-026a)

The full per-request budget is five distinct reservations, not one lump pool — see `data-model.md` for the authoritative table:

1. System instructions (fixed per mode) — 2. Current request/input (variable, existing shortening path) — 3. Image input (`IMAGE_RESERVE_TOKENS`, existing, only when an image is active/referenced) — 4. **Selected-context pool** (`ContextBudgetPolicy.maximumUnits`, this contract) — 5. Generated output (`getResponseGenerationLimit(mode)`, existing).

Bucket 4 is the only bucket this contract's `ContextBudgetPolicy` sizes; it MUST NOT be allowed to grow into headroom reserved for buckets 1, 2, 3, or 5.

## ContextBudgetPolicy (interface unchanged, implementation replaced)

```ts
export interface ContextBudgetPolicy {
  readonly policyId: string;               // 'token-estimate-budget-v1'
  readonly maximumUnits: number;           // now tokens (selected-context-pool bucket), not characters
  readonly recentExactTurnLimit: number;
  readonly maxMediaEvidenceItems: number;
  readonly maxFactItems: number;
  readonly maxSummaryEntries: number;
  measure(content: string): number;        // tier-1 token estimate, not content.length
}
```

- **MUST** implement the same interface `ContextOrchestrator` already selects/evicts against — no change to orchestrator selection/eviction algorithms, only to what `measure()` returns and what `maximumUnits` means (spec FR-026).
- **MUST NOT** call `llama.rn`'s native `tokenize()` synchronously in the per-candidate selection hot path (research.md §1 tier 1); `measure()` remains a pure, synchronous, in-process function.

## Reconciliation with ContextWindow (new requirement)

- The router's `maximumUnits` (bucket 4) for a given response mode **MUST** be derived from (or kept ≤) the same real constraint `ContextWindow.trimMessagesToContextWithReport` already enforces: `QWEN_CONTEXT_TOKEN_LIMIT - getResponseGenerationLimit(mode) - CONTEXT_SAFETY_TOKENS`, once buckets 1/2/3 are subtracted, so the router never selects a source set that the downstream hard trim would still need to silently cut (spec FR-027).
- Tier-2 format/tokenize/reduce/re-tokenize **MUST** be the actual
  reconciliation mechanism. A reduction is never assumed to fit from estimates
  alone, and diagnostics record both the initial estimate and final native count
  when available.

## Protected sources and eviction order (fixes the Spec-006-era "always-protected floor" assumption)

- Current request text and any explicitly referenced or active image evidence are
  reserved first and **never** evicted for another source (spec FR-028).
- When assembled context exceeds the token budget, eviction order is: cross-chat retrieved items → same-chat retrieved items → durable facts → older-range summary entries → **the recent-turn floor, but only for a request that has one to begin with** (spec FR-030). A request classified purely as an independent text question has **no recent-turn floor at all** (spec FR-003/FR-004) — there is nothing in this eviction chain to reach for that request beyond "current request only." This corrects the Spec-006-era assumption that a recent-turn floor is unconditionally protected for every request; see spec Superseded Requirements.
- Current request and protected image evidence are never evicted under any circumstance, for any classification.
- Protected image evidence may force eviction or deterministic compaction of
  lower-priority context, but final diagnostic `usedUnits` MUST NOT exceed
  `maximumUnits`.

## Provider-independent assembly extension

- Current request, required image entities, direct references, and other
  `requiredContextSources` are protected independently of legacy classification.
- Provider switching replaces context/token/generation limits and tokenizer
  behavior through `MainModelCapabilities`; it does not change selection,
  provenance, ledger, memory, or retrieval schemas.
- Assembly preserves generation headroom and performs bounded final
  provider-native verification before inference. Failure to prove a fit produces
  a safe fallback, not silent removal of a required image/reference.

## Invariants

- `measure()` output for identical input is deterministic and stable across calls (spec FR-006).
- Per-mode budgets remain monotonic (Low < Medium < High) after recalibration to tokens, mirroring the existing monotonic character-based constraint from Spec 006.
- The five reserved buckets always sum to at most `QWEN_CONTEXT_TOKEN_LIMIT - CONTEXT_SAFETY_TOKENS` for any given request.
