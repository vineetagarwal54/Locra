# Contract: Model-Independent Embedding Provider and Index Lifecycle

Application planning, memory, and retrieval code depend on this boundary, not
directly on EmbeddingGemma or a Qwen runtime.

Planner authority is independent of this provider. An unavailable, unapproved,
building, stale, or failed embedding runtime leaves deterministic planning,
ledger state, recent dependency, exact/lexical retrieval, explicit memories,
deterministic reference resolution, and permitted constrained fallback fully
operational. Lexical-only is a supported authoritative runtime mode.

## Provider contract

```ts
interface EmbeddingProvider {
  getDescriptor(): EmbeddingModelDescriptor;
  getReadiness(): Promise<EmbeddingRuntimeReadiness>;
  embedQuery(input: EmbeddingQueryInput, signal: AbortSignal): Promise<EmbeddingVector>;
  embedDocuments(input: readonly EmbeddingDocumentInput[], signal: AbortSignal):
    Promise<readonly EmbeddingVector[]>;
}

interface EmbeddingModelDescriptor {
  readonly providerId: string;
  readonly modelId: string;
  readonly artifactIdentity: string;
  readonly dimensions: number;
  readonly promptPolicyVersion: string;
  readonly normalization: 'l2' | 'none';
  readonly runtimeCompatibility: string;
}
```

Query and document embeddings are separate operations because their prompt
policies may differ. Every stored vector records the provider/model descriptor,
artifact identity, dimensions, prompt-policy version, normalization policy,
source revision, and index version.

## Initial EmbeddingGemma responsibilities

Subject to artifact approval and runtime/device validation, EmbeddingGemma is the
first planned provider for:

- same-chat and opt-in cross-chat semantic retrieval;
- code-block retrieval;
- explicit-memory and image-evidence retrieval through text representations;
- active-topic and entity similarity;
- semantic intent and reference-resolution signals supplied to the planner.

EmbeddingGemma MUST NOT generate final answers, inspect image pixels,
independently decide the complete turn plan, replace lexical retrieval, or
determine source reliability.

## Index lifecycle

- Activation is feature-gated and requires recorded artifact, license, hash,
  runtime, New Architecture, NDK, memory, latency, and device approval.
- Indexes are versioned independently of canonical conversation data.
- Backfill is background, restart-safe, idempotent, and resumable from persisted
  progress. Process death may lose only the uncommitted batch and resumes from
  the last committed cursor.
- Indexing yields or pauses for visible inference and other higher-priority
  device work under the single-flight resource policy.
- Lexical retrieval remains available while indexing is incomplete, paused,
  stale, incompatible, cancelled, or failed.
- Vectors are stale when the embedding model, artifact, dimensions,
  prompt-policy version, normalization policy, or source revision differs from
  the active index descriptor.
- Migration operationally builds a new index version while lexical fallback
  remains available, validates it, atomically activates it, and retires the
  previous index later. Canonical messages and memories are never rewritten or
  lost because an embedding model changes.
- Conversation deletion cascades to all related retrieval units and vectors.
- Cancellation is cooperative and leaves restart-safe progress; it does not
  corrupt the active index.

## Dimension benchmark

The initial production dimension is not hardcoded by this architecture.
Implementation research MUST benchmark at least 256 and 512 dimensions on the
golden retrieval corpus and representative physical devices, evaluating
retrieval quality, latency, memory, storage, backfill time, and battery impact.
The selected value is recorded in the provider/index descriptor and may later be
migrated through the lifecycle above.

## Activation independence

- Planner `authoritative` mode MUST be validated with no approved embedding
  provider and with `lexical-fallback`.
- Same-chat semantic activation has its own gate.
- Cross-chat semantic activation has a separate gate and may remain disabled
  after same-chat activation.
- Changing the main chat/vision provider does not stale or rebuild this index.
  Only an embedding compatibility-key change does.
