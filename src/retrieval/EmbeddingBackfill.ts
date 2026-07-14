import type {
  EmbeddingSource,
  EmbeddingUpsertInput,
} from '../persistence/EmbeddingRepository';
import type { EmbeddingState, EmbeddingRow } from '../types/models';

import type { EmbeddingService } from './EmbeddingService';

export const EMBEDDING_BACKFILL_BATCH_LIMIT = 25;

export interface EmbeddingSourceUnit {
  readonly id: string;
  readonly conversationId: string;
  readonly source: EmbeddingSource;
  readonly sourceRevision: string;
  readonly createdAt: number;
}

export interface EmbeddingBackfillRepository {
  upsert(input: EmbeddingUpsertInput): void;
  pendingBatch(limit: number): EmbeddingRow[];
  getSourceText(row: EmbeddingRow): string | null;
  updateResult(id: string, vector: Float32Array, state: Extract<EmbeddingState, 'ready'>): void;
  updateState(id: string, state: Extract<EmbeddingState, 'failed'>): void;
}

export interface EmbeddingBackfillOptions {
  readonly hasUserVisibleWork?: () => boolean;
  readonly yieldToUi?: () => Promise<void>;
}

export class EmbeddingBackfill {
  private readonly hasUserVisibleWork: () => boolean;
  private readonly yieldToUi: () => Promise<void>;

  constructor(
    private readonly repository: EmbeddingBackfillRepository,
    private readonly service: EmbeddingService,
    options: EmbeddingBackfillOptions = {},
  ) {
    this.hasUserVisibleWork = options.hasUserVisibleWork ?? (() => false);
    this.yieldToUi = options.yieldToUi ?? defaultYieldToUi;
  }

  enqueue(units: readonly EmbeddingSourceUnit[]): void {
    for (const unit of units) {
      this.repository.upsert({
        id: unit.id,
        conversationId: unit.conversationId,
        source: unit.source,
        modelId: this.service.modelId,
        modelArtifactHash: this.service.modelArtifactHash,
        embeddingVersion: this.service.embeddingVersion,
        dimensions: this.service.dimensions,
        sourceRevision: unit.sourceRevision,
        vector: new Float32Array(),
        state: 'pending',
        createdAt: unit.createdAt,
      });
    }
  }

  async runIdleBatch(): Promise<number> {
    if (this.hasUserVisibleWork()) {
      return 0;
    }
    const rows = this.repository.pendingBatch(EMBEDDING_BACKFILL_BATCH_LIMIT);
    let completed = 0;
    for (const row of rows) {
      if (this.hasUserVisibleWork()) {
        break;
      }
      const text = this.repository.getSourceText(row);
      if (text === null) {
        this.repository.updateState(row.id, 'failed');
        continue;
      }
      try {
        const [vector] = await this.service.embed([text]);
        if (vector === undefined) {
          throw new Error('Embedding runtime returned no vector.');
        }
        this.repository.updateResult(row.id, vector, 'ready');
        completed += 1;
      } catch {
        this.repository.updateState(row.id, 'failed');
      }
      await this.yieldToUi();
    }
    return completed;
  }
}

function defaultYieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

