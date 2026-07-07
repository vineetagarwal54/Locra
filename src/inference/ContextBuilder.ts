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
      ? 'This is the first follow-up in the conversation.'
      : recentTurns.map(formatTurn).join('\n\n');

  // The extraction is grounding for facts ABOUT the photo, never a fence around
  // the whole answer — follow-ups routinely leave the image behind entirely
  // ("my pan is sticky, how do I fix it?") and must get real, knowledgeable help.
  return [
    'Here is what you already observed in the photo this chat is about. Treat it as a',
    'reliable record of what the image shows, and rely on it for anything about the',
    'picture itself:',
    input.pinnedExtraction,
    '',
    'Conversation so far:',
    previousTurns,
    '',
    'Now answer their next message. Use the photo notes above when the picture is',
    'relevant, and draw freely on everything else you know to give a genuinely useful,',
    'confident answer — including when the question goes well beyond the photo.',
    '',
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
