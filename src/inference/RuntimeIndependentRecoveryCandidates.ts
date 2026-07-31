import type { ImageEntity } from '../persistence/ImageEntityRepository';
import type { CanonicalConversationSnapshot, ContextMemoryFact } from '../types/models';

import type { IndependentRecoveryCandidate } from './IndependentRoutingRecovery';
import { isToolRefusalResponse } from './ToolRefusalRecovery';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'did', 'do', 'does', 'for', 'from', 'how', 'i', 'in',
  'is', 'it', 'me', 'my', 'of', 'on', 'the', 'to', 'was', 'what', 'when', 'where',
  'which', 'who', 'why', 'with', 'you', 'your',
]);

export interface RuntimeRecoveryCandidateOptions {
  readonly imageEntities?: readonly ImageEntity[];
  readonly activeComparisonImageIds?: readonly string[];
  readonly entityAliases?: readonly RuntimeRecoveryEntityAlias[];
}

export interface RuntimeRecoveryEntityAlias {
  readonly id: string;
  readonly sourceMessageId: string;
  readonly aliases: readonly string[];
}

export function buildRuntimeIndependentRecoveryCandidates(
  snapshot: CanonicalConversationSnapshot,
  options: RuntimeRecoveryCandidateOptions = {},
): IndependentRecoveryCandidate[] {
  const queryTokens = meaningfulTokens(snapshot.currentMessage.text);
  const candidates: IndependentRecoveryCandidate[] = [];
  const eligibleMessages = snapshot.priorMessages.filter((message) =>
    message.status === 'completed'
    && (
      message.role === 'user'
      || (message.role === 'assistant' && !isToolRefusalResponse(message.text))
    ),
  );
  const uniqueSingleTokenMatches = findUniqueSingleTokenMatches(
    queryTokens,
    eligibleMessages.map((message) => ({
      id: message.id,
      tokens: meaningfulTokens(message.text),
    })),
  );
  const directSlots = possessiveFactSlots(snapshot.currentMessage.text);

  for (const message of eligibleMessages) {
    const sourceTokens = meaningfulTokens(message.text);
    const hasDirectSlot = message.role === 'user'
      && [...directSlots].some((slot) => sourceHasPossessiveSlot(message.text, slot));
    if (
      !hasBoundedExactOverlap(queryTokens, sourceTokens)
      && !uniqueSingleTokenMatches.has(message.id)
      && !hasDirectSlot
    ) {
      continue;
    }
    const userFact = message.role === 'user' && (isUserFact(message.text) || hasDirectSlot);
    candidates.push({
      id: `${userFact ? 'user-fact' : 'same-chat'}:${message.id}`,
      kind: userFact ? 'user-fact' : 'same-chat-lexical',
      sourceMessageId: message.id,
      content: message.text,
      exactOrDirect: true,
    });
  }

  for (const fact of snapshot.contextMemory?.importantFacts ?? []) {
    addFactCandidate(candidates, fact, queryTokens);
  }

  for (const attachment of snapshot.currentMessage.attachments) {
    if (attachment.kind !== 'image') continue;
    candidates.push({
      id: `attachment:${attachment.imageAssetId ?? attachment.path}`,
      kind: 'attached-image',
      sourceMessageId: snapshot.currentMessage.id,
      content: null,
      exactOrDirect: true,
    });
  }

  const orderedImages = [...(options.imageEntities ?? [])].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
  const ordinalIds = referencedOrdinalImageIds(snapshot.currentMessage.text, orderedImages);
  for (const image of orderedImages) {
    const direct = referencesImageDirectly(snapshot.currentMessage.text, image.id)
      || ordinalIds.has(image.id);
    if (!direct) continue;
    candidates.push({
      id: `image:${image.id}`,
      kind: 'explicit-image-reference',
      sourceMessageId: image.sourceMessageId,
      content: image.id,
      exactOrDirect: true,
    });
  }

  addUniqueAliasCandidate(
    candidates,
    snapshot.currentMessage.text,
    options.entityAliases ?? [],
  );

  if (referencesActiveComparison(snapshot.currentMessage.text)) {
    for (const imageId of options.activeComparisonImageIds ?? []) {
      const image = options.imageEntities?.find((candidate) => candidate.id === imageId);
      if (image === undefined) continue;
      candidates.push({
        id: `comparison:${image.id}`,
        kind: 'active-comparison-target',
        sourceMessageId: image.sourceMessageId,
        content: image.id,
        exactOrDirect: true,
      });
    }
  }

  return uniqueCandidates(candidates);
}

function addUniqueAliasCandidate(
  candidates: IndependentRecoveryCandidate[],
  query: string,
  entities: readonly RuntimeRecoveryEntityAlias[],
): void {
  const queryTokens = normalizedTokens(query);
  const matches = entities.filter((entity) =>
    entity.aliases.some((alias) =>
      containsTokenSequence(queryTokens, normalizedTokens(alias)),
    ),
  );
  if (matches.length !== 1) return;
  const match = matches[0];
  if (match === undefined) return;
  candidates.push({
    id: `entity:${match.id}`,
    kind: 'direct-entity',
    sourceMessageId: match.sourceMessageId,
    content: match.id,
    exactOrDirect: true,
  });
}

function referencesActiveComparison(text: string): boolean {
  const tokens = new Set(normalizedTokens(text));
  return ['compare', 'both', 'them', 'their', 'they', 'these', 'those']
    .some((token) => tokens.has(token));
}

function containsTokenSequence(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  return haystack.some((_, start) =>
    needle.every((token, offset) => haystack[start + offset] === token),
  );
}

function normalizedTokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
}

function referencedOrdinalImageIds(
  text: string,
  images: readonly ImageEntity[],
): ReadonlySet<string> {
  const tokens = new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const ids = new Set<string>();
  if (tokens.has('first') && images[0] !== undefined) ids.add(images[0].id);
  if (tokens.has('second') && images[1] !== undefined) ids.add(images[1].id);
  if (tokens.has('third') && images[2] !== undefined) ids.add(images[2].id);
  return ids;
}

function addFactCandidate(
  candidates: IndependentRecoveryCandidate[],
  fact: ContextMemoryFact,
  queryTokens: ReadonlySet<string>,
): void {
  if (!hasBoundedExactOverlap(queryTokens, meaningfulTokens(fact.text))) return;
  candidates.push({
    id: `memory:${fact.id}`,
    kind: 'explicit-memory',
    sourceMessageId: fact.sourceMessageId,
    content: fact.text,
    exactOrDirect: true,
  });
}

function meaningfulTokens(value: string): ReadonlySet<string> {
  const tokens = value.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
  return new Set(tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

function hasBoundedExactOverlap(
  query: ReadonlySet<string>,
  source: ReadonlySet<string>,
): boolean {
  let matches = 0;
  for (const token of query) {
    if (!source.has(token)) continue;
    matches += 1;
    if (matches >= 2) return true;
  }
  return false;
}

function findUniqueSingleTokenMatches(
  query: ReadonlySet<string>,
  sources: readonly {
    readonly id: string;
    readonly tokens: ReadonlySet<string>;
  }[],
): ReadonlySet<string> {
  const matchedSourceIds = new Set<string>();
  for (const token of query) {
    if (!isStrongExactToken(token)) continue;
    const matches = sources.filter((source) => source.tokens.has(token));
    if (matches.length === 1 && matches[0] !== undefined) {
      matchedSourceIds.add(matches[0].id);
    }
  }
  return matchedSourceIds;
}

function isStrongExactToken(token: string): boolean {
  return token.length >= 4 && ![
    'answer', 'detail', 'explain', 'image', 'meaning', 'question', 'thing',
  ].includes(token);
}

function possessiveFactSlots(value: string): ReadonlySet<string> {
  const slots = new Set<string>();
  const pattern = /\b(?:my|our)\s+([a-z0-9]+(?:-[a-z0-9]+)*)\b/gi;
  for (const match of value.matchAll(pattern)) {
    const slot = match[1]?.toLowerCase();
    if (slot !== undefined && isStrongExactToken(slot)) {
      slots.add(slot);
    }
  }
  return slots;
}

function sourceHasPossessiveSlot(value: string, slot: string): boolean {
  const tokens = normalizedTokens(value);
  return tokens.some(
    (token, index) =>
      (token === 'my' || token === 'our')
      && tokens[index + 1] === slot,
  );
}

function isUserFact(value: string): boolean {
  return /\b\d+(?:[.,]\d+)?\b/.test(value)
    || /\b(?:my|our)\s+[a-z0-9-]+\s+(?:is|was|are|were)\b/i.test(value);
}

function referencesImageDirectly(text: string, imageId: string): boolean {
  const normalized = text.toLowerCase();
  const id = imageId.toLowerCase();
  return normalized.includes(id) || normalized.includes(`image ${id}`);
}

function uniqueCandidates(
  candidates: readonly IndependentRecoveryCandidate[],
): IndependentRecoveryCandidate[] {
  const byId = new Map<string, IndependentRecoveryCandidate>();
  for (const candidate of candidates) byId.set(candidate.id, candidate);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
