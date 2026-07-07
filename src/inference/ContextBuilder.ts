export interface ContextTurn {
  question: string;
  answer: string;
}

export interface BuildPinnedContextPromptInput {
  pinnedExtraction: string;
  turns: ContextTurn[];
  question: string;
  recentTurnLimit?: number;
}

export const DEFAULT_RECENT_TURN_LIMIT = 4;

export function buildPinnedContextPrompt(input: BuildPinnedContextPromptInput): string {
  const recentTurns = input.turns.slice(-resolveRecentTurnLimit(input.recentTurnLimit));
  const previousTurns =
    recentTurns.length === 0
      ? 'No previous user turns are available.'
      : recentTurns.map(formatTurn).join('\n\n');

  return [
    'Use the pinned visual extraction as non-evictable image context.',
    'Do not claim visual facts that are not present in that extraction.',
    'Pinned visual extraction:',
    input.pinnedExtraction,
    'Previous turns:',
    previousTurns,
    'Current follow-up question:',
    input.question.trim(),
  ].join('\n');
}

function resolveRecentTurnLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_RECENT_TURN_LIMIT;
  }
  return Math.max(0, Math.floor(limit));
}

function formatTurn(turn: ContextTurn, index: number): string {
  return [`Turn ${index + 1}`, `User: ${turn.question}`, `Locra: ${turn.answer}`].join('\n');
}
