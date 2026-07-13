import type {
  ConversationRepository,
  ConversationTargetCandidateRow,
} from '../persistence/ConversationRepository';

export interface ConversationCandidate {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type ConversationTargetResolution =
  | { readonly kind: 'active' }
  | { readonly kind: 'scoped'; readonly conversationId: string }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly ConversationCandidate[] }
  | { readonly kind: 'not-found' };

export interface ConversationTargetReference {
  readonly rawText?: string;
  readonly selectedId?: string;
}

export class ConversationTargetResolver {
  constructor(
    private readonly conversations: Pick<
      ConversationRepository,
      'getConversation' | 'findTargetCandidates'
    >,
  ) {}

  resolve(reference: ConversationTargetReference): ConversationTargetResolution {
    if (reference.selectedId !== undefined) {
      return this.conversations.getConversation(reference.selectedId) === null
        ? { kind: 'not-found' }
        : { kind: 'scoped', conversationId: reference.selectedId };
    }
    const namedTarget = extractNamedTarget(reference.rawText ?? '');
    if (namedTarget === null) {
      return { kind: 'active' };
    }
    const candidates = this.conversations.findTargetCandidates(tokenizeTarget(namedTarget), 10)
      .map(toCandidate);
    if (candidates.length === 0) {
      return { kind: 'not-found' };
    }
    if (candidates.length === 1) {
      return { kind: 'scoped', conversationId: candidates[0].id };
    }
    return { kind: 'ambiguous', candidates };
  }
}

export function extractNamedTarget(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const patterns = [
    /\buse\s+(?:my\s+)?(.+?)\s+(?:chat|conversation)\b/i,
    /\b(?:from|in|using)\s+(?:my\s+)?(.+?)\s+(?:chat|conversation)\b/i,
    /\b(?:chat|conversation)\s+(?:about|named|called)\s+(.+?)(?:[?.!,]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern)?.[1]?.trim();
    if (match !== undefined && match !== '') {
      return match;
    }
  }
  return null;
}

function tokenizeTarget(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
}

function toCandidate(row: ConversationTargetCandidateRow): ConversationCandidate {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
