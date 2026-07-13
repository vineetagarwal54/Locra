export type RetrievalContentType = 'chunk' | 'evidence' | 'fact';

export interface RetrievalCandidate {
  readonly id: string;
  readonly sourceConversationId: string;
  readonly sourceMessageId: string;
  readonly imageAssetId: string | null;
  readonly timestamp: number;
  readonly contentType: RetrievalContentType;
  readonly text: string;
}

export interface CompatibleEmbeddingCandidate extends RetrievalCandidate {
  readonly vector: Float32Array;
}

export interface RetrievedItem extends RetrievalCandidate {
  readonly score: number;
}

