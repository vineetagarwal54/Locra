export interface LexicalLedgerItem {
  readonly id: string;
  readonly canonicalLabel: string;
  readonly aliases: readonly string[];
}

export interface LexicalLedgerMatchInput {
  readonly userText: string;
  readonly topics: readonly LexicalLedgerItem[];
  readonly entities: readonly LexicalLedgerItem[];
  readonly activeComparisonTargetIds: readonly string[];
  readonly directReferenceIds: readonly string[];
  readonly comparisonRequested: boolean;
}

export interface LexicalLedgerMatches {
  readonly topicIds: readonly string[];
  readonly entityIds: readonly string[];
  readonly comparisonTargetIds: readonly string[];
}

export function resolveLexicalLedgerMatches(
  input: LexicalLedgerMatchInput,
): LexicalLedgerMatches {
  const normalizedText = normalizeLexical(input.userText);
  const directIds = new Set(input.directReferenceIds);
  const topicIds = input.topics
    .filter((topic) => directIds.has(topic.id) || itemMatches(normalizedText, topic))
    .map((topic) => topic.id)
    .sort((left, right) => left.localeCompare(right));
  const entityIds = input.entities
    .filter((entity) => directIds.has(entity.id) || itemMatches(normalizedText, entity))
    .map((entity) => entity.id)
    .sort((left, right) => left.localeCompare(right));
  const comparisonTargetIds = input.activeComparisonTargetIds
    .filter(
      (id) =>
        input.comparisonRequested
        || directIds.has(id)
        || containsExactLexical(normalizedText, normalizeLexical(id)),
    )
    .sort((left, right) => left.localeCompare(right));

  return { topicIds, entityIds, comparisonTargetIds };
}

function itemMatches(normalizedText: string, item: LexicalLedgerItem): boolean {
  const labels = [item.id, item.canonicalLabel, ...item.aliases];
  return labels.some((label) =>
    containsExactLexical(normalizedText, normalizeLexical(label)),
  );
}

function containsExactLexical(normalizedText: string, normalizedCandidate: string): boolean {
  if (normalizedCandidate === '') {
    return false;
  }
  return ` ${normalizedText} `.includes(` ${normalizedCandidate} `);
}

function normalizeLexical(value: string): string {
  return value
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9_$.-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
