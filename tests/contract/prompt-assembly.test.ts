// Contract for the prompt-assembly path — the guard against the scope-refusal
// regression. The rule the whole path must satisfy:
//
//   Perception rigor (visible-only / no-speculation) belongs to the TURN-1
//   wrapper around the image message ONLY. The persistent identity, and every
//   follow-up turn, must be free to answer beyond the photo using general
//   knowledge, and must never refuse a benign request on scope grounds.
//
// The reported bug was a benign off-image follow-up ("my pan is sticky, how do
// I fix it?") drawing a scope-shaped refusal ("my primary function is visual
// content") because the extraction rule had leaked into the persistent system
// prompt. These tests fail if that leak ever returns.

import { buildPinnedContextPrompt } from '../../src/inference/ContextBuilder';
import { buildStructuredExtractionPrompt } from '../../src/inference/ExtractionPrompt';
import { LOCRA_SYSTEM_PROMPT } from '../../src/inference/SystemPrompt';

// Scope-refusal / perception-restriction language that must NEVER appear in
// anything persistent (the system prompt) or in a plain follow-up instruction.
const SCOPE_LANGUAGE: Array<{ label: string; pattern: RegExp }> = [
  { label: 'visible-only restriction', pattern: /\bvisible\b/i },
  { label: 'no-speculation rule', pattern: /speculat/i },
  { label: 'no-guessing rule', pattern: /\bguess\b/i },
  { label: '"just an AI" hedge', pattern: /just an ai/i },
  { label: '"primary function" scoping', pattern: /primary function/i },
  { label: '"can only" / "only ... images" scoping', pattern: /can only|only (?:help|assist|answer|respond).{0,20}(?:image|photo|picture)/i },
  { label: 'conciseness clamp', pattern: /\bconcise\b/i },
];

const OFF_IMAGE_FOLLOW_UP = 'My pan is sticky, how do I fix it?';
const PINNED_EXTRACTION = [
  'Subject/object: cast-iron skillet',
  'Visible features: black, round, metal handle',
  'Visible text: None visible',
  'Visible condition: dull, patchy residue',
].join('\n');

describe('persistent system prompt (identity, applied every turn)', () => {
  it.each(SCOPE_LANGUAGE)('contains no $label', ({ pattern }) => {
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(pattern);
  });

  it('establishes a bold, helpful, never-refuse identity', () => {
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/you are locra/i);
    // Explicitly invites drawing on general knowledge...
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/everything you know|know a great deal/i);
    // ...and explicitly forbids scope deflection.
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/do not deflect|never.{0,20}deflect/i);
  });
});

describe('benign off-image follow-up assembly (turn 2+)', () => {
  const prompt = buildPinnedContextPrompt({
    pinnedExtraction: PINNED_EXTRACTION,
    turns: [{ question: 'What is this?', answer: PINNED_EXTRACTION }],
    question: OFF_IMAGE_FOLLOW_UP,
  });

  it('does NOT reinstate the old "do not claim facts beyond the extraction" fence', () => {
    expect(prompt).not.toMatch(/do not claim/i);
    expect(prompt).not.toMatch(/only.{0,30}(?:present in|in that|in the) extraction/i);
    expect(prompt).not.toMatch(/speculat/i);
  });

  it('invites general knowledge for questions that go beyond the photo', () => {
    expect(prompt).toMatch(/draw freely on everything else you know/i);
    expect(prompt).toMatch(/beyond the photo/i);
  });

  it('still grounds visual facts in the pinned extraction (regression guard)', () => {
    expect(prompt).toContain(PINNED_EXTRACTION);
    expect(prompt).toContain(OFF_IMAGE_FOLLOW_UP);
  });
});

describe('turn-1 extraction wrapper (perception rigor lives HERE, and only here)', () => {
  const prompt = buildStructuredExtractionPrompt('What is this?');

  it('keeps the visible-only rule scoped to this one perception step', () => {
    expect(prompt).toMatch(/only what is directly visible|state only what/i);
    expect(prompt).toMatch(/this step only|one-time perception/i);
  });

  it('keeps the no-speculation / no-guessing rule', () => {
    expect(prompt).toMatch(/do not speculate/i);
    expect(prompt).toMatch(/do not guess/i);
  });

  it('still demands JSON-only output for the parser', () => {
    expect(prompt).toMatch(/valid json only/i);
  });
});
