export interface ManualEvaluationTurn {
  readonly prompt: string;
  readonly imageFixture?: string;
  readonly action?: 'submit' | 'retry';
}

export interface ManualEvaluationCase {
  readonly id: string;
  readonly category: 'short-chat' | 'long-chat' | 'image-answer' | 'retry';
  readonly setup: readonly string[];
  readonly turns: readonly ManualEvaluationTurn[];
  readonly expectations: readonly string[];
}

export const HYBRID_CONTEXT_EVALUATION_CASES: readonly ManualEvaluationCase[] = [
  {
    id: 'short-chat-direct-follow-up',
    category: 'short-chat',
    setup: [],
    turns: [
      { prompt: 'My train arrives at 6:40 PM.' },
      { prompt: 'What time did I say it arrives?' },
    ],
    expectations: ['Recalls 6:40 PM', 'Does not introduce unrelated history'],
  },
  {
    id: 'long-chat-early-fact',
    category: 'long-chat',
    setup: ['Seed at least 30 unrelated completed turns after the first turn.'],
    turns: [
      { prompt: 'The storage unit access code is 4182.' },
      { prompt: 'What was the storage unit access code?' },
    ],
    expectations: ['Recovers 4182', 'Keeps the response scoped to the active conversation'],
  },
  {
    id: 'image-evidence-follow-up',
    category: 'image-answer',
    setup: ['Use the approved evaluation image containing a clearly visible expiry date.'],
    turns: [
      { prompt: 'What expiry date is visible?', imageFixture: 'expiry-date-reference' },
      { prompt: 'Repeat that date without reinterpreting the image.' },
    ],
    expectations: ['Answers from persisted evidence on the follow-up', 'Does not substitute another image'],
  },
  {
    id: 'failed-attempt-retry',
    category: 'retry',
    setup: ['Interrupt the first assistant attempt after visible text begins streaming.'],
    turns: [
      { prompt: 'Summarize the three decisions in this conversation.' },
      { prompt: '', action: 'retry' },
    ],
    expectations: ['Creates a new attempt', 'Preserves the interrupted attempt for diagnostics'],
  },
] as const;

