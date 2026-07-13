// FR-054: every completed answer is trimmed, and its tail checked for the two
// small-VLM failure modes this feature targets — stopping mid-sentence
// (truncation) and repeating a trailing phrase (looping). Pure functions with
// no RN imports, so HistoryScreen can re-assess persisted answers at render
// time without any schema change.

export type AnswerVerdict = 'complete' | 'truncated' | 'looping';

export interface ProcessedAnswer {
  text: string;
  verdict: AnswerVerdict;
}

/** Sentence-terminal characters; a tail ending on none of these reads as cut off. */
const TERMINAL_CHARS = new Set(['.', '!', '?', '…', ':', ';']);
/** Closers that may legitimately follow the terminal punctuation. */
const TRAILING_CLOSERS = /["'’”)\]}»]+$/;
/** How many trailing words to consider when hunting for a repeated phrase. */
const MAX_LOOP_PHRASE_WORDS = 8;
/** A phrase must appear this many times consecutively at the tail to count as a loop. */
const MIN_LOOP_REPEATS = 3;

export function postProcessAnswer(raw: string): ProcessedAnswer {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { text: '', verdict: 'complete' };
  }

  const collapsed = collapseLoopingTail(trimmed);
  if (collapsed !== null) {
    return { text: collapsed, verdict: 'looping' };
  }

  if (endsMidSentence(trimmed)) {
    return { text: trimmed, verdict: 'truncated' };
  }

  return { text: trimmed, verdict: 'complete' };
}

/** Verdict-only variant for re-assessing already-persisted history answers. */
export function assessAnswerQuality(raw: string): AnswerVerdict {
  return postProcessAnswer(raw).verdict;
}

function endsMidSentence(text: string): boolean {
  const withoutClosers = text.replace(TRAILING_CLOSERS, '');
  if (withoutClosers === '') {
    return false;
  }
  return !TERMINAL_CHARS.has(withoutClosers[withoutClosers.length - 1]);
}

/**
 * Detects a phrase of 1–{@link MAX_LOOP_PHRASE_WORDS} words repeated at least
 * {@link MIN_LOOP_REPEATS} times consecutively at the very end of the text,
 * and returns the text with the surplus repeats dropped — or null when no
 * such loop exists.
 */
function collapseLoopingTail(text: string): string | null {
  const words = text.split(/\s+/);

  for (let phraseLength = MAX_LOOP_PHRASE_WORDS; phraseLength >= 1; phraseLength -= 1) {
    if (words.length < phraseLength * MIN_LOOP_REPEATS) {
      continue;
    }

    const phrase = words.slice(-phraseLength).join(' ');
    let repeats = 1;
    while (
      words.length >= phraseLength * (repeats + 1) &&
      words.slice(-phraseLength * (repeats + 1), -phraseLength * repeats).join(' ') === phrase
    ) {
      repeats += 1;
    }

    if (repeats >= MIN_LOOP_REPEATS) {
      return words.slice(0, words.length - phraseLength * (repeats - 1)).join(' ');
    }
  }

  return null;
}
