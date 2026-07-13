import type {
  DeviceResourcePolicy,
  ResourceLease,
} from '../inference/DeviceResourcePolicy';

export interface EmbeddingArtifactManifest {
  readonly modelId: string;
  readonly modelPath: string;
  readonly modelArtifactHash: string;
  readonly embeddingVersion: string;
  readonly dimensions: number;
}

export interface NativeEmbeddingContext {
  embedding(text: string, params?: { embd_normalize?: number }): Promise<{ embedding: number[] }>;
  release(): Promise<void>;
}

export interface NativeEmbeddingBinding {
  initLlama(params: {
    model: string;
    embedding: true;
    embd_normalize: number;
  }): Promise<NativeEmbeddingContext>;
}

export class EmbeddingService {
  readonly modelId: string;
  readonly modelArtifactHash: string;
  readonly embeddingVersion: string;
  readonly dimensions: number;

  constructor(
    private readonly manifest: EmbeddingArtifactManifest,
    private readonly binding: NativeEmbeddingBinding,
    private readonly resourcePolicy: DeviceResourcePolicy,
  ) {
    this.modelId = manifest.modelId;
    this.modelArtifactHash = manifest.modelArtifactHash;
    this.embeddingVersion = manifest.embeddingVersion;
    this.dimensions = manifest.dimensions;
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }
    const lease = await this.resourcePolicy.acquire('embedding');
    return this.embedWithLease(texts, lease);
  }

  private async embedWithLease(
    texts: readonly string[],
    lease: ResourceLease,
  ): Promise<Float32Array[]> {
    let context: NativeEmbeddingContext | null = null;
    try {
      context = await this.binding.initLlama({
        model: this.manifest.modelPath,
        embedding: true,
        embd_normalize: 2,
      });
      const vectors: Float32Array[] = [];
      for (const text of texts) {
        const result = await context.embedding(text, { embd_normalize: 2 });
        if (result.embedding.length !== this.dimensions) {
          throw new Error(
            `Embedding dimensions mismatch: expected ${this.dimensions}, received ${result.embedding.length}.`,
          );
        }
        vectors.push(new Float32Array(result.embedding));
      }
      return vectors;
    } finally {
      try {
        await context?.release();
      } finally {
        lease.release();
      }
    }
  }
}

