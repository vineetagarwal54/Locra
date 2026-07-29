# Contract: Conversation State Ledger and Memory Layers

The ledger is lightweight derived state over canonical SQLite messages. It
accelerates planning and reference resolution; it never replaces, edits, or
compacts away canonical messages.

## ConversationStateLedger

```ts
interface ConversationStateLedger {
  readonly conversationId: string;
  readonly revision: number;
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

Referenced artifacts include code blocks and supported documents. Ledger
updates are deterministic execution results from completed turns and explicit
user actions. Failed or cancelled attempts may update operational status but
MUST NOT establish facts, decisions, or authoritative reference targets.

## Required memory layers

1. **Immediate working memory**: current request, current action, required recent
   turns, and current attachments.
2. **Conversation-state ledger**: active topics, entities, comparisons, images,
   artifacts, unresolved references, explicit decisions, and explicit memory
   writes.
3. **Explicit durable memories**: user-directed memory statements, available to
   planning and retrieval immediately after the source message is persisted.
4. **Episodic retrieval units**: typed message-derived events and evidence.
5. **Segment summaries**: bounded summaries of message ranges with provenance.
6. **Image evidence**: structured, image-scoped visual evidence distinct from
   image pixels and assistant prose.
7. **Optional cross-chat memory**: explicitly enabled retrieval across eligible
   conversations; disabled by default and subject to conversation exclusion.

## Provenance, reliability, and invalidation

- Canonical messages remain the source of truth.
- Every derived ledger entry, memory, summary, fact, retrieval unit, and image
  evidence record retains source-message IDs and a source revision.
- Editing, superseding, or deleting a source invalidates or rebuilds dependent
  derived records. Conversation deletion cascades to ledger state, retrieval
  units, summaries, image evidence links, and vectors.
- User-stated facts and explicit user decisions have distinct reliability from
  completed assistant prose and structured image evidence.
- Assistant-generated claims MUST NOT automatically become durable facts or
  receive the same reliability as user-stated facts or structured image
  evidence.
- Refusal-like, unsupported, failed, cancelled, interrupted, or superseded
  assistant attempts are ineligible as trusted factual evidence.

## Immediate explicit memory

An explicit memory write is persisted and made available to the current
conversation immediately. It MUST NOT wait for token thresholds, segment
compaction, background summarization, embedding backfill, or app restart.
Semantic indexing may occur later; exact lexical lookup and direct ledger/memory
access remain available in the meantime.

## Follow-up behavior

The ledger supplies candidates for natural references such as “Which one is
better?”, “Which of the two should I use?”, “What are its prices?”, “Compare it
with the previous one.”, and “What did I decide?”. It does not itself author the
answer or silently resolve an ambiguous reference; the unified planner validates
the candidate resolution.
