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
  /** The chat the request is typed in; excluded from cross-chat candidates. */
  readonly activeConversationId?: string;
}

type ResolverConversations = Pick<
  ConversationRepository,
  'getConversation' | 'findTargetCandidates' | 'getMostRecentOther'
>;

export class ConversationTargetResolver {
  constructor(private readonly conversations: ResolverConversations) {}

  resolve(reference: ConversationTargetReference): ConversationTargetResolution {
    if (reference.selectedId !== undefined) {
      return this.conversations.getConversation(reference.selectedId) === null
        ? { kind: 'not-found' }
        : { kind: 'scoped', conversationId: reference.selectedId };
    }

    const rawText = reference.rawText ?? '';
    const active = reference.activeConversationId;

    // "Do you remember our previous chat?" / "what did we discuss last time?" —
    // the referent is simply the most recently updated OTHER conversation.
    if (referencesPreviousChat(rawText)) {
      const recent = active === undefined ? null : this.conversations.getMostRecentOther(active);
      return recent === null
        ? { kind: 'not-found' }
        : { kind: 'scoped', conversationId: recent.id };
    }

    const namedTarget = extractNamedTarget(rawText);
    if (namedTarget === null) {
      return { kind: 'active' };
    }
    const candidates = this.conversations
      .findTargetCandidates(tokenizeTarget(namedTarget), 10)
      .map(toCandidate)
      .filter((candidate) => candidate.id !== active);
    if (candidates.length === 0) {
      return { kind: 'not-found' };
    }
    if (candidates.length === 1) {
      return { kind: 'scoped', conversationId: candidates[0].id };
    }
    return { kind: 'ambiguous', candidates };
  }
}

/** Natural phrasings that mean "the conversation before this one", with no title. */
export function referencesPreviousChat(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const patterns = [
    /\b(?:previous|last|earlier|prior|other|another)\s+(?:chat|conversation|discussion|thread)\b/i,
    /\bour\s+(?:previous|last|earlier|prior)\b/i,
    /\blast time\b/i,
    /\bearlier\s+(?:today|conversation|we\s+(?:talked|discussed))\b/i,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

export function extractNamedTarget(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const patterns = [
    // "the chat where we discussed SSDs" / "conversation about the budget"
    /\b(?:chat|conversation)\s+(?:where|when)\s+we\s+(?:discussed|talked about|covered|were discussing)\s+(.+?)(?:[?.!,]|$)/i,
    /\b(?:chat|conversation)\s+(?:about|named|called|regarding|on)\s+(.+?)(?:[?.!,]|$)/i,
    /\bwhere\s+we\s+(?:discussed|talked about|covered)\s+(.+?)(?:[?.!,]|$)/i,
    // "from my Japan trip chat" / "in the tax notes conversation"
    /\b(?:from|in|using)\s+(?:my\s+|the\s+|our\s+)?(.+?)\s+(?:chat|conversation)\b/i,
    /\buse\s+(?:my\s+|the\s+|our\s+)?(.+?)\s+(?:chat|conversation)\b/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern)?.[1]?.trim();
    if (match !== undefined && match !== '' && !isFillerTarget(match)) {
      return match;
    }
  }
  return null;
}

/** Rejects article-only matches (e.g. "the", "that") that carry no title tokens. */
function isFillerTarget(value: string): boolean {
  return tokenizeTarget(value).length === 0;
}

function tokenizeTarget(value: string): string[] {
  const stopWords = new Set(['the', 'my', 'our', 'that', 'this', 'a', 'an']);
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !stopWords.has(token));
}

function toCandidate(row: ConversationTargetCandidateRow): ConversationCandidate {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
