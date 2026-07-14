export const CHUNK_MAX_CHARACTERS = 800;
export const CHUNK_OVERLAP_CHARACTERS = 120;

export interface ChunkSourceMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly imageAssetId?: string | null;
  readonly text: string;
  readonly sourceRevision: string;
  readonly createdAt: number;
}

export interface MessageChunk {
  readonly id: string;
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly imageAssetId: string | null;
  readonly chunkVersion: string;
  readonly ordinal: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly text: string;
  readonly sourceRevision: string;
  readonly createdAt: number;
}

export class ChunkingService {
  constructor(private readonly chunkVersion: string) {}

  chunk(message: ChunkSourceMessage): MessageChunk[] {
    if (message.text.length <= CHUNK_MAX_CHARACTERS) {
      return [this.createChunk(message, 0, 0, message.text.length)];
    }

    const chunks: MessageChunk[] = [];
    const step = CHUNK_MAX_CHARACTERS - CHUNK_OVERLAP_CHARACTERS;
    for (let start = 0, ordinal = 0; start < message.text.length; start += step, ordinal += 1) {
      const end = Math.min(start + CHUNK_MAX_CHARACTERS, message.text.length);
      chunks.push(this.createChunk(message, ordinal, start, end));
      if (end === message.text.length) {
        break;
      }
    }
    return chunks;
  }

  private createChunk(
    message: ChunkSourceMessage,
    ordinal: number,
    startOffset: number,
    endOffset: number,
  ): MessageChunk {
    return {
      id: `${message.id}:${this.chunkVersion}:${ordinal}`,
      conversationId: message.conversationId,
      sourceMessageId: message.id,
      imageAssetId: message.imageAssetId ?? null,
      chunkVersion: this.chunkVersion,
      ordinal,
      startOffset,
      endOffset,
      text: message.text.slice(startOffset, endOffset),
      sourceRevision: message.sourceRevision,
      createdAt: message.createdAt,
    };
  }
}

