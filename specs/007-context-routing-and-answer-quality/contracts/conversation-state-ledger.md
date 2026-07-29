# Contract: Conversation State Ledger and Memory Layers

The ledger is versioned derived state over canonical SQLite messages and
persisted structured records. It accelerates planning/reference resolution; it
never replaces or mutates canonical history.

## ConversationStateLedger

```ts
interface ConversationStateLedger {
  readonly conversationId: string;
  readonly schemaVersion: string;
  readonly revision: number;
  readonly sourceStateHash: string;
  readonly status: 'ready' | 'stale' | 'rebuilding' | 'corrupt';
  readonly activeTopics: readonly LedgerTopic[];
  readonly activeEntities: readonly LedgerEntity[];
  readonly comparisonTargetIds: readonly string[];
  readonly activeImageIds: readonly string[];
  readonly referencedArtifactIds: readonly string[];
  readonly unresolvedReferences: readonly LedgerReference[];
  readonly recentDecisions: readonly LedgerDecision[];
  readonly explicitMemoryWriteIds: readonly string[];
  readonly sourceMessageIds: readonly string[];
  readonly updatedAt: string;
}
```

Referenced artifacts include code blocks and supported documents. Comparison
targets and active images are explicitly ordered. Failed/cancelled/refusal-like
attempts may affect operational status but cannot establish facts, decisions, or
authoritative references.

## Completion ordering

For every completed canonical turn:

1. Persist the completed canonical turn.
2. Derive and validate execution results.
3. Update or rebuild ledger state.
4. Publish the updated ledger before planning the next turn.

The next turn must not observe a ledger one completed turn behind. Concurrent
submission is serialized at the turn-completion/planning boundary; failure to
publish a valid ledger triggers deterministic rebuild or conservative planning
from canonical/exact sources.

## Cold start and cache safety

Ledger persistence is a cache. Canonical messages and structured records remain
the source of truth. Missing, incompatible, stale, or corrupt caches rebuild from
canonical data before they are trusted. A corrupt ledger cannot write to or
corrupt canonical history. An existing conversation is never treated as a first
turn merely because its cache is absent.

## Supported invalidation semantics

Each derived item stores source-message IDs and a `sourceRevision`
content/status/version hash. Spec 007 invalidates/rebuilds for:

- source creation or deletion;
- conversation deletion;
- retry and regenerated attempts;
- superseded assistant attempts;
- structured-evidence reinference;
- model/index/policy version changes;
- derived-record rebuilds.

General source-message editing is out of scope. Conversation deletion cascades
to ledger state, retrieval units, summaries, evidence links, and vectors.
Retries/regenerations expose only the active eligible attempt as current state;
superseded attempts remain auditable but cannot establish trusted facts.

## Required memory layers

1. Immediate working memory: current request/action/attachments and required
   recent inputs.
2. Conversation-state ledger.
3. Explicit durable memories.
4. Episodic typed retrieval units.
5. Provenance-bearing segment summaries.
6. Image-scoped structured evidence.
7. Optional cross-chat memory, off by default and filtered bilaterally.

## Explicit-memory interpretation

Detection combines explicit user command/action semantics, structured planner
output, deterministic validation, user-stated factual content, and current
memory-scope settings. Open-ended regex is not the primary authority.

- “Remember my rent is $1,689.” → write.
- “Save my unit as 3427-014.” → write.
- “My move-in date is August 10; remember it.” → write.
- “Do you remember my rent?” → read.
- “Remember when we discussed graphs?” → read.
- “I remember that algorithm.” → neither automatic read nor write.

An uncertain write is not persisted durably without clarification. It may remain
conversation-scoped. Confirmed writes are directly and lexically available as
soon as source persistence completes; they do not wait for compaction,
summarization, embeddings, backfill, or restart.

A user correction creates a new active memory that links to and supersedes the
prior memory. Both source provenances remain auditable, but normal recall returns
only the newest active value. Deletion/invalidation removes the affected value
from eligibility before the next plan.

## Ordinal reliability

Highest to lowest:

1. Direct user-stated fact or explicit user decision.
2. Confirmed structured evidence from source pixels.
3. Deterministically extracted exact content with provenance.
4. Confirmed durable derived fact.
5. Completed grounded assistant answer.
6. Ordinary assistant-generated answer.
7. Uncertain assistant answer.
8. Refusal-like, failed, interrupted, cancelled, or superseded attempt.

Higher reliability may break relevance ties. A low-reliability source cannot
override an exact higher-reliability fact. Rank 8 is ineligible as trusted
factual evidence. Semantic similarity alone cannot promote an assistant claim
into a durable fact. Final numerical ranking weights are a benchmark task.

## Cross-chat scope

An explicit memory is always available inside its source conversation. If the
source conversation is later excluded from cross-chat, neither that memory nor
its source contributes elsewhere; the excluded conversation also receives no
cross-chat content. Exclusion does not delete canonical/local memory.

## Follow-up behavior

The ledger supplies ordered candidates for “Which one is better?”, “Which of the
two should I use?”, “What are its prices?”, “Compare it with the previous one”,
and “What did I decide?”. It never authors the answer or guesses among ambiguous
candidates; `TurnPlan` validates resolution.
