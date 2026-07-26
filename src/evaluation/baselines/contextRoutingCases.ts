export type ContextRoutingBaselineCategory =
  | 'independent-question'
  | 'text-follow-up'
  | 'image-new'
  | 'image-same'
  | 'image-older'
  | 'image-ambiguous'
  | 'image-pixel-dependent'
  | 'long-conversation'
  | 'repetition-verbosity';

export interface ContextRoutingBaselineTurn {
  readonly prompt: string;
  readonly imageFixture?: string;
}

export interface ContextRoutingBaselineCase {
  readonly id: string;
  readonly category: ContextRoutingBaselineCategory;
  readonly setup: readonly string[];
  readonly turns: readonly ContextRoutingBaselineTurn[];
  readonly expectedObservation: readonly string[];
  readonly measurementIds: readonly string[];
}

/** Stable manual before/after fixtures for Spec 007. */
export const CONTEXT_ROUTING_BASELINE_CASES: readonly ContextRoutingBaselineCase[] = [
  {
    id: 'independent-question-with-unrelated-history',
    category: 'independent-question',
    setup: ['Seed unrelated recent turns, one durable fact, one summary, and image evidence.'],
    turns: [{ prompt: 'What is the capital of Japan?' }],
    expectedObservation: ['Answer is direct', 'No unrelated context influences the answer'],
    measurementIds: ['MV-001'],
  },
  {
    id: 'short-referential-follow-up',
    category: 'text-follow-up',
    setup: [],
    turns: [
      { prompt: 'My train arrives at 6:40 PM.' },
      { prompt: 'What time did I say it arrives?' },
    ],
    expectedObservation: ['Recalls 6:40 PM', 'Keeps the answer scoped to the needed turn'],
    measurementIds: ['MV-002'],
  },
  {
    id: 'new-image-question',
    category: 'image-new',
    setup: ['Use the approved receipt fixture.'],
    turns: [{ prompt: 'What is shown here?', imageFixture: 'receipt-reference' }],
    expectedObservation: ['Runs vision inference', 'Persists image evidence'],
    measurementIds: ['MV-004'],
  },
  {
    id: 'same-image-evidence-follow-up',
    category: 'image-same',
    setup: ['Complete the new-image-question fixture first.'],
    turns: [
      { prompt: 'What is shown here?', imageFixture: 'receipt-reference' },
      { prompt: 'What kind of document is that image?' },
    ],
    expectedObservation: ['Reuses stored evidence', 'Does not reprocess original pixels'],
    measurementIds: ['MV-005'],
  },
  {
    id: 'older-image-explicit-reference',
    category: 'image-older',
    setup: ['Use two visibly distinct approved image fixtures.'],
    turns: [
      { prompt: 'Describe this.', imageFixture: 'receipt-reference' },
      { prompt: 'Describe this.', imageFixture: 'chair-reference' },
      { prompt: 'What total was visible in the first image?' },
    ],
    expectedObservation: ['Resolves the first image', 'Never substitutes the active image'],
    measurementIds: ['MV-006', 'MV-007'],
  },
  {
    id: 'ambiguous-image-reference',
    category: 'image-ambiguous',
    setup: ['Use three visibly distinct approved image fixtures.'],
    turns: [
      { prompt: 'Describe this.', imageFixture: 'receipt-reference' },
      { prompt: 'Describe this.', imageFixture: 'chair-reference' },
      { prompt: 'Describe this.', imageFixture: 'label-reference' },
      { prompt: 'What is visible in the image?' },
    ],
    expectedObservation: [
      'Defaults to the active image',
      'Diagnostics disclose imageReferenceAmbiguous',
    ],
    measurementIds: ['MV-008'],
  },
  {
    id: 'pixel-dependent-follow-up',
    category: 'image-pixel-dependent',
    setup: ['Use an approved image with small readable text.'],
    turns: [
      { prompt: 'What is this?', imageFixture: 'expiry-date-reference' },
      { prompt: 'Read the exact expiry date from the image.' },
    ],
    expectedObservation: ['Re-runs original pixels', 'Persists a newer evidence version'],
    measurementIds: ['MV-009'],
  },
  {
    id: 'long-conversation-earlier-detail',
    category: 'long-conversation',
    setup: ['Seed at least 30 completed turns after storing code 4182 near the beginning.'],
    turns: [
      { prompt: 'The storage unit access code is 4182.' },
      { prompt: 'What was the storage unit access code I mentioned earlier?' },
    ],
    expectedObservation: ['Recovers 4182', 'Selection remains deterministic and bounded'],
    measurementIds: ['MV-003', 'MV-010'],
  },
  {
    id: 'short-answer-and-loop-resistance',
    category: 'repetition-verbosity',
    setup: ['Run once in each response mode and capture generated-token counts.'],
    turns: [
      { prompt: 'What is 2 + 2?' },
      { prompt: 'Explain in detail how photosynthesis works.' },
      { prompt: 'Repeat the word pattern ABC ABC while explaining why it repeats.' },
    ],
    expectedObservation: [
      'Short answer is not padded',
      'Detailed request retains useful detail',
      'Repeated tail does not run to the hard limit',
    ],
    measurementIds: ['MV-011'],
  },
] as const;
