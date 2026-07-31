export const CONVERSATION_FOCUS_LEDGER_VERSION = 'conversation-focus-ledger-v1';

const CACHE_KEY_PREFIX = 'conversation-focus-ledger:';
const MAX_ACTIVE_LABELS = 12;
const MAX_LABEL_LENGTH = 80;

export type ConversationFocusImage =
  | { readonly kind: 'single'; readonly imageId: string }
  | { readonly kind: 'pair'; readonly imageIds: readonly [string, string] };

export interface ConversationFocusArtifact {
  readonly kind: 'code' | 'document';
  readonly messageId: string;
}

export interface ConversationFocusUnresolvedReference {
  readonly targetType: 'image';
  readonly candidateIds: readonly string[];
  readonly sourceMessageId: string;
}

export interface ConversationFocusLedger {
  readonly conversationId: string;
  readonly schemaVersion: typeof CONVERSATION_FOCUS_LEDGER_VERSION;
  readonly sourceStateHash: string;
  readonly lastCompletedTurnId: string | null;
  readonly activeImageFocus: ConversationFocusImage | null;
  readonly lastExplicitlyReferencedImageIds: readonly string[];
  readonly activeAssistantMessageId: string | null;
  readonly activeArtifact: ConversationFocusArtifact | null;
  readonly activeTopicLabels: readonly string[];
  readonly activeEntityLabels: readonly string[];
  readonly unresolvedReference: ConversationFocusUnresolvedReference | null;
  readonly sourceMessageIds: readonly string[];
  readonly updatedAt: number | null;
}

export interface ConversationFocusSourceMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly replyToMessageId: string | null;
  readonly attemptNumber: number | null;
  readonly activeAttempt: boolean;
  readonly text: string;
  readonly status: 'submitted' | 'generating' | 'completed' | 'failed' | 'interrupted';
  readonly createdAt: number;
  readonly finalizedAt: number | null;
}

export interface ConversationFocusSourceImage {
  readonly id: string;
  readonly sourceMessageId: string;
  readonly ordinal: number;
  readonly availability: 'available' | 'missing' | 'deleted' | 'unsupported';
  readonly createdAt: number;
}

export interface ConversationFocusSource {
  readonly conversationId: string;
  readonly messages: readonly ConversationFocusSourceMessage[];
  readonly images: readonly ConversationFocusSourceImage[];
}

export interface ConversationStateLedgerCache {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
}

export interface ConversationFocusPlannerInput {
  readonly lastCompletedTurnId: string | null;
  readonly activeImageIds: readonly string[];
  readonly lastExplicitlyReferencedImageIds: readonly string[];
  readonly activeAssistantMessageId: string | null;
  readonly activeArtifactMessageId: string | null;
  readonly activeArtifactKind?: ConversationFocusArtifact['kind'] | null;
  readonly activeTopicLabels: readonly string[];
  readonly activeEntityLabels: readonly string[];
  readonly unresolvedReference: ConversationFocusUnresolvedReference | null;
}

interface CanonicalFocusTurn {
  readonly turnId: string;
  readonly user: ConversationFocusSourceMessage;
  readonly assistant: ConversationFocusSourceMessage;
}

export class ConversationStateLedgerRepository {
  constructor(
    private readonly cache: ConversationStateLedgerCache,
    private readonly readSource: (conversationId: string) => ConversationFocusSource,
  ) {}

  get(conversationId: string): ConversationFocusLedger {
    const source = this.readSource(conversationId);
    const derived = deriveConversationFocusLedger(source);
    const cached = this.readCached(conversationId);
    if (
      cached !== null
      && cached.sourceStateHash === derived.sourceStateHash
      && isLedgerValidForSource(cached, source)
      && JSON.stringify(cached) === JSON.stringify(derived)
    ) {
      return cached;
    }
    this.write(derived);
    return derived;
  }

  publish(conversationId: string): ConversationFocusLedger {
    const ledger = deriveConversationFocusLedger(this.readSource(conversationId));
    this.write(ledger);
    return ledger;
  }

  delete(conversationId: string): void {
    this.cache.remove(cacheKey(conversationId));
  }

  private readCached(conversationId: string): ConversationFocusLedger | null {
    const raw = this.cache.getString(cacheKey(conversationId));
    if (raw === undefined) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return isConversationFocusLedger(value, conversationId) ? value : null;
    } catch {
      return null;
    }
  }

  private write(ledger: ConversationFocusLedger): void {
    this.cache.set(cacheKey(ledger.conversationId), JSON.stringify(ledger));
  }
}

export function deriveConversationFocusLedger(
  source: ConversationFocusSource,
): ConversationFocusLedger {
  const turns = canonicalTurns(source.messages);
  const canonicalUserIds = new Set(turns.map((turn) => turn.user.id));
  const canonicalImages = source.images
    .filter((candidate) => canonicalUserIds.has(candidate.sourceMessageId))
    .sort(compareImages);
  const sourceStateHash = hashSourceState(turns, canonicalImages);
  const imageBySource = groupImagesBySource(canonicalImages);

  let activeImageFocus: ConversationFocusImage | null = null;
  let lastExplicitlyReferencedImageIds: readonly string[] = [];
  let activeAssistantMessageId: string | null = null;
  let activeArtifact: ConversationFocusArtifact | null = null;
  let activeTopicLabels: readonly string[] = [];
  let activeEntityLabels: readonly string[] = [];
  let unresolvedReference: ConversationFocusUnresolvedReference | null = null;
  const seenImages: ConversationFocusSourceImage[] = [];
  const sourceMessageIds: string[] = [];

  for (const turn of turns) {
    sourceMessageIds.push(turn.user.id, turn.assistant.id);
    activeAssistantMessageId = turn.assistant.id;

    const labels = explicitLabels(turn.user.text);
    if (labels.topics.length > 0) activeTopicLabels = labels.topics;
    if (labels.entities.length > 0) activeEntityLabels = labels.entities;

    const userArtifact = artifactForMessage(turn.user);
    const assistantArtifact = artifactForMessage(turn.assistant);
    if (userArtifact !== null) activeArtifact = userArtifact;
    if (assistantArtifact !== null) activeArtifact = assistantArtifact;

    const attached = (imageBySource.get(turn.user.id) ?? [])
      .filter((candidate) => candidate.availability === 'available');
    seenImages.push(...attached);
    if (attached.length > 0) {
      const attachedIds = unique(attached.map((candidate) => candidate.id));
      lastExplicitlyReferencedImageIds = attachedIds;
      activeImageFocus = focusForAttachedImages(attachedIds, turn.user.text);
      unresolvedReference = null;
      continue;
    }

    const availableImages = seenImages.filter(
      (candidate) => candidate.availability === 'available',
    );
    const resolution = resolveExplicitImageFocus(
      turn.user.text,
      availableImages,
      activeImageFocus,
    );
    if (resolution.kind === 'resolved') {
      lastExplicitlyReferencedImageIds = resolution.imageIds;
      activeImageFocus = resolution.imageIds.length === 2
        ? {
            kind: 'pair',
            imageIds: [resolution.imageIds[0], resolution.imageIds[1]],
          }
        : { kind: 'single', imageId: resolution.imageIds[0] };
      unresolvedReference = null;
    } else if (resolution.kind === 'unresolved') {
      unresolvedReference = {
        targetType: 'image',
        candidateIds: resolution.candidateIds,
        sourceMessageId: turn.user.id,
      };
    }
  }

  const lastTurn = turns.at(-1) ?? null;
  return {
    conversationId: source.conversationId,
    schemaVersion: CONVERSATION_FOCUS_LEDGER_VERSION,
    sourceStateHash,
    lastCompletedTurnId: lastTurn?.turnId ?? null,
    activeImageFocus: removeUnavailableFocus(activeImageFocus, canonicalImages),
    lastExplicitlyReferencedImageIds: lastExplicitlyReferencedImageIds.filter(
      (imageId) => isAvailableImage(imageId, canonicalImages),
    ),
    activeAssistantMessageId,
    activeArtifact,
    activeTopicLabels,
    activeEntityLabels,
    unresolvedReference: sanitizeUnresolvedReference(unresolvedReference, canonicalImages),
    sourceMessageIds,
    updatedAt:
      lastTurn === null
        ? null
        : lastTurn.assistant.finalizedAt ?? lastTurn.assistant.createdAt,
  };
}

export function toConversationFocusPlannerInput(
  ledger: ConversationFocusLedger,
): ConversationFocusPlannerInput {
  return {
    lastCompletedTurnId: ledger.lastCompletedTurnId,
    activeImageIds: imageIdsFromFocus(ledger.activeImageFocus),
    lastExplicitlyReferencedImageIds: [...ledger.lastExplicitlyReferencedImageIds],
    activeAssistantMessageId: ledger.activeAssistantMessageId,
    activeArtifactMessageId: ledger.activeArtifact?.messageId ?? null,
    activeArtifactKind: ledger.activeArtifact?.kind ?? null,
    activeTopicLabels: [...ledger.activeTopicLabels],
    activeEntityLabels: [...ledger.activeEntityLabels],
    unresolvedReference: ledger.unresolvedReference,
  };
}

export function emptyConversationFocusLedger(
  conversationId: string,
): ConversationFocusLedger {
  return deriveConversationFocusLedger({ conversationId, messages: [], images: [] });
}

function canonicalTurns(
  messages: readonly ConversationFocusSourceMessage[],
): CanonicalFocusTurn[] {
  const users = messages
    .filter((message) => message.role === 'user')
    .sort(compareMessages);
  const attemptsByUser = new Map<string, ConversationFocusSourceMessage[]>();
  for (const message of messages) {
    if (message.role !== 'assistant' || message.replyToMessageId === null) continue;
    const attempts = attemptsByUser.get(message.replyToMessageId) ?? [];
    attempts.push(message);
    attemptsByUser.set(message.replyToMessageId, attempts);
  }

  const turns: CanonicalFocusTurn[] = [];
  for (const userMessage of users) {
    const assistantMessage = canonicalAssistantFor(
      attemptsByUser.get(userMessage.id) ?? [],
    );
    if (assistantMessage === null) continue;
    turns.push({
      turnId: userMessage.id,
      user: userMessage,
      assistant: assistantMessage,
    });
  }
  return turns;
}

function canonicalAssistantFor(
  rawAttempts: readonly ConversationFocusSourceMessage[],
): ConversationFocusSourceMessage | null {
  const attempts = [...rawAttempts].sort(compareAttempts);
  const active = attempts.find((attempt) => attempt.activeAttempt) ?? null;
  if (active?.status === 'completed') return active;
  if (active === null) return null;

  const activeAttemptNumber = active.attemptNumber ?? Number.MAX_SAFE_INTEGER;
  return attempts
    .filter(
      (attempt) =>
        attempt.status === 'completed'
        && (attempt.attemptNumber ?? 0) < activeAttemptNumber,
    )
    .at(-1) ?? null;
}

function resolveExplicitImageFocus(
  text: string,
  images: readonly ConversationFocusSourceImage[],
  activeFocus: ConversationFocusImage | null,
):
  | { readonly kind: 'none' }
  | { readonly kind: 'resolved'; readonly imageIds: readonly [string] | readonly [string, string] }
  | { readonly kind: 'unresolved'; readonly candidateIds: readonly string[] } {
  if (images.length === 0) return { kind: 'none' };
  const directIds = directImageIds(text, images);
  const ordinalIds = ordinalImageIds(text, images);
  const explicitIds = unique([...directIds, ...ordinalIds]);
  const normalized = normalizeSyntax(text);
  const tokens = new Set(normalized.split(' ').filter((token) => token !== ''));
  const comparisonRequested = normalized.startsWith('compare ');

  if (comparisonRequested && explicitIds.length === 2) {
    return { kind: 'resolved', imageIds: [explicitIds[0], explicitIds[1]] };
  }
  if (comparisonRequested && explicitIds.length > 2) {
    return { kind: 'unresolved', candidateIds: explicitIds };
  }
  if (explicitIds.length === 1) {
    return { kind: 'resolved', imageIds: [explicitIds[0]] };
  }
  if (explicitIds.length === 2 && tokens.has('both')) {
    return { kind: 'resolved', imageIds: [explicitIds[0], explicitIds[1]] };
  }
  if (explicitIds.length > 1) {
    return { kind: 'unresolved', candidateIds: explicitIds };
  }

  if (comparisonRequested && images.length === 2) {
    return { kind: 'resolved', imageIds: [images[0].id, images[1].id] };
  }
  if (
    comparisonRequested
    && activeFocus?.kind === 'pair'
    && (tokens.has('them') || normalized.includes('both images'))
  ) {
    return { kind: 'resolved', imageIds: activeFocus.imageIds };
  }
  if (hasGenericImageReference(normalized)) {
    return images.length === 1
      ? { kind: 'resolved', imageIds: [images[0].id] }
      : { kind: 'unresolved', candidateIds: images.map((image) => image.id) };
  }
  return { kind: 'none' };
}

function directImageIds(
  text: string,
  images: readonly ConversationFocusSourceImage[],
): string[] {
  const tokens = new Set(
    text.toLocaleLowerCase().match(/[a-z0-9_-]+/g) ?? [],
  );
  return images
    .filter((image) => tokens.has(image.id.toLocaleLowerCase()))
    .map((image) => image.id);
}

function ordinalImageIds(
  text: string,
  images: readonly ConversationFocusSourceImage[],
): string[] {
  const normalized = normalizeSyntax(text);
  const indexes = new Set<number>();
  const ordinalPhrases: ReadonlyArray<readonly [number, readonly string[]]> = [
    [0, ['first image', 'image 1', '1st image']],
    [1, ['second image', 'image 2', '2nd image']],
    [2, ['third image', 'image 3', '3rd image']],
    [3, ['fourth image', 'image 4', '4th image']],
    [4, ['fifth image', 'image 5', '5th image']],
  ];
  for (const [index, phrases] of ordinalPhrases) {
    if (phrases.some((phrase) => normalized.includes(phrase))) indexes.add(index);
  }
  if (normalized.includes('previous image') || normalized.includes('older image')) {
    indexes.add(images.length - 2);
  }
  if (
    normalized.includes('latest image')
    || normalized.includes('last image')
    || normalized.includes('current image')
  ) {
    indexes.add(images.length - 1);
  }
  return [...indexes]
    .filter((index) => index >= 0 && index < images.length)
    .sort((left, right) => left - right)
    .map((index) => images[index].id);
}

function focusForAttachedImages(
  imageIds: readonly string[],
  text: string,
): ConversationFocusImage {
  if (imageIds.length >= 2 && normalizeSyntax(text).startsWith('compare ')) {
    return { kind: 'pair', imageIds: [imageIds[0], imageIds[1]] };
  }
  return { kind: 'single', imageId: imageIds.at(-1) as string };
}

function hasGenericImageReference(normalized: string): boolean {
  return [
    'the image',
    'this image',
    'that image',
    'the photo',
    'this photo',
    'that photo',
    'the picture',
    'this picture',
    'that picture',
  ].some((phrase) => normalized.includes(phrase));
}

function explicitLabels(text: string): {
  readonly topics: readonly string[];
  readonly entities: readonly string[];
} {
  const topics: string[] = [];
  const entities: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const kind = line.slice(0, separator).trim().toLocaleLowerCase();
    const label = line.slice(separator + 1).trim();
    if (label === '' || label.length > MAX_LABEL_LENGTH) continue;
    if (kind === 'topic') topics.push(label);
    if (kind === 'entity') entities.push(label);
  }
  return {
    topics: unique(topics).slice(0, MAX_ACTIVE_LABELS),
    entities: unique(entities).slice(0, MAX_ACTIVE_LABELS),
  };
}

function artifactForMessage(
  message: ConversationFocusSourceMessage,
): ConversationFocusArtifact | null {
  if (/^```(?:document|doc|markdown|md)(?:\s|$)/im.test(message.text)) {
    return { kind: 'document', messageId: message.id };
  }
  if (/^```[a-z0-9_-]*(?:\s|$)/im.test(message.text)) {
    return { kind: 'code', messageId: message.id };
  }
  if (/(?:^|\s)[^\s]+\.(?:pdf|docx|md|txt|csv)(?:\s|$)/i.test(message.text)) {
    return { kind: 'document', messageId: message.id };
  }
  return null;
}

function groupImagesBySource(
  images: readonly ConversationFocusSourceImage[],
): Map<string, ConversationFocusSourceImage[]> {
  const grouped = new Map<string, ConversationFocusSourceImage[]>();
  for (const image of images) {
    const values = grouped.get(image.sourceMessageId) ?? [];
    values.push(image);
    grouped.set(image.sourceMessageId, values);
  }
  return grouped;
}

function hashSourceState(
  turns: readonly CanonicalFocusTurn[],
  images: readonly ConversationFocusSourceImage[],
): string {
  const canonical = {
    turns: turns.map((turn) => ({
      turnId: turn.turnId,
      userId: turn.user.id,
      userText: turn.user.text,
      assistantId: turn.assistant.id,
      assistantText: turn.assistant.text,
      assistantFinalizedAt: turn.assistant.finalizedAt,
    })),
    images: images.map((image) => ({
      id: image.id,
      sourceMessageId: image.sourceMessageId,
      ordinal: image.ordinal,
      availability: image.availability,
      createdAt: image.createdAt,
    })),
  };
  return fnv1a(JSON.stringify(canonical));
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function removeUnavailableFocus(
  focus: ConversationFocusImage | null,
  images: readonly ConversationFocusSourceImage[],
): ConversationFocusImage | null {
  if (focus === null) return null;
  const ids = imageIdsFromFocus(focus).filter((imageId) => isAvailableImage(imageId, images));
  if (ids.length === 2) return { kind: 'pair', imageIds: [ids[0], ids[1]] };
  if (ids.length === 1) return { kind: 'single', imageId: ids[0] };
  return null;
}

function sanitizeUnresolvedReference(
  reference: ConversationFocusUnresolvedReference | null,
  images: readonly ConversationFocusSourceImage[],
): ConversationFocusUnresolvedReference | null {
  if (reference === null) return null;
  const candidateIds = reference.candidateIds.filter(
    (imageId) => isAvailableImage(imageId, images),
  );
  return candidateIds.length > 1 ? { ...reference, candidateIds } : null;
}

function isAvailableImage(
  imageId: string,
  images: readonly ConversationFocusSourceImage[],
): boolean {
  return images.some(
    (image) => image.id === imageId && image.availability === 'available',
  );
}

function imageIdsFromFocus(focus: ConversationFocusImage | null): string[] {
  if (focus === null) return [];
  return focus.kind === 'single' ? [focus.imageId] : [...focus.imageIds];
}

function isLedgerValidForSource(
  ledger: ConversationFocusLedger,
  source: ConversationFocusSource,
): boolean {
  const availableIds = new Set(
    source.images
      .filter((image) => image.availability === 'available')
      .map((image) => image.id),
  );
  return imageIdsFromFocus(ledger.activeImageFocus).every((id) => availableIds.has(id))
    && ledger.lastExplicitlyReferencedImageIds.every((id) => availableIds.has(id))
    && (ledger.unresolvedReference?.candidateIds.every((id) => availableIds.has(id)) ?? true);
}

function isConversationFocusLedger(
  value: unknown,
  conversationId: string,
): value is ConversationFocusLedger {
  if (!isRecord(value)) return false;
  return value.conversationId === conversationId
    && value.schemaVersion === CONVERSATION_FOCUS_LEDGER_VERSION
    && typeof value.sourceStateHash === 'string'
    && nullableString(value.lastCompletedTurnId)
    && isConversationFocusImage(value.activeImageFocus)
    && stringArray(value.lastExplicitlyReferencedImageIds)
    && nullableString(value.activeAssistantMessageId)
    && isConversationFocusArtifact(value.activeArtifact)
    && stringArray(value.activeTopicLabels)
    && stringArray(value.activeEntityLabels)
    && isUnresolvedReference(value.unresolvedReference)
    && stringArray(value.sourceMessageIds)
    && (value.updatedAt === null || typeof value.updatedAt === 'number');
}

function isConversationFocusImage(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (value.kind === 'single') return typeof value.imageId === 'string';
  return value.kind === 'pair'
    && stringArray(value.imageIds)
    && value.imageIds.length === 2;
}

function isConversationFocusArtifact(value: unknown): boolean {
  return value === null
    || (
      isRecord(value)
      && (value.kind === 'code' || value.kind === 'document')
      && typeof value.messageId === 'string'
    );
}

function isUnresolvedReference(value: unknown): boolean {
  return value === null
    || (
      isRecord(value)
      && value.targetType === 'image'
      && stringArray(value.candidateIds)
      && typeof value.sourceMessageId === 'string'
    );
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareMessages(
  left: ConversationFocusSourceMessage,
  right: ConversationFocusSourceMessage,
): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function compareAttempts(
  left: ConversationFocusSourceMessage,
  right: ConversationFocusSourceMessage,
): number {
  return (left.attemptNumber ?? 0) - (right.attemptNumber ?? 0)
    || compareMessages(left, right);
}

function compareImages(
  left: ConversationFocusSourceImage,
  right: ConversationFocusSourceImage,
): number {
  return left.createdAt - right.createdAt
    || left.ordinal - right.ordinal
    || left.id.localeCompare(right.id);
}

function normalizeSyntax(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function cacheKey(conversationId: string): string {
  return `${CACHE_KEY_PREFIX}${conversationId}`;
}
