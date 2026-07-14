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
/** Fenced code block delimiter — content between a pair is never de-duplicated. */
const CODE_FENCE = /(```[\s\S]*?```)/g;

export function postProcessAnswer(raw: string): ProcessedAnswer {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { text: '', verdict: 'complete' };
  }

  // First remove confirmed consecutive repeated sentences/paragraphs (a small-VLM
  // loop that spans whole units), preserving fenced code blocks verbatim. Then the
  // word-level tail check catches partial-phrase loops the segment pass can't.
  const deduped = collapseRepeatedSegments(trimmed);
  const tailCollapsed = collapseLoopingTail(deduped.text);
  const text = tailCollapsed ?? deduped.text;
  if (deduped.changed || tailCollapsed !== null) {
    return { text, verdict: 'looping' };
  }

  if (endsMidSentence(text)) {
    return { text, verdict: 'truncated' };
  }

  return { text, verdict: 'complete' };
}

/** Verdict-only variant for re-assessing already-persisted history answers. */
export function assessAnswerQuality(raw: string): AnswerVerdict {
  return postProcessAnswer(raw).verdict;
}

interface DedupResult {
  readonly text: string;
  readonly changed: boolean;
}

/**
 * Removes only *confirmed consecutive* repeated paragraphs and sentences — the
 * whole-unit loop a small model sometimes emits — while leaving fenced code
 * blocks (```…```) untouched so repeated lines inside code survive. Splitting on
 * the fences keeps code content out of the sentence/paragraph passes entirely.
 */
function collapseRepeatedSegments(text: string): DedupResult {
  const parts = text.split(CODE_FENCE);
  let changed = false;
  const rebuilt = parts.map((part) => {
    if (part.startsWith('```')) {
      return part;
    }
    const collapsed = collapseProseRepeats(part);
    if (collapsed !== part) {
      changed = true;
    }
    return collapsed;
  });
  return { text: rebuilt.join(''), changed };
}

/** De-duplicates consecutive identical paragraphs, then consecutive identical sentences. */
function collapseProseRepeats(prose: string): string {
  if (prose.trim() === '') {
    return prose;
  }
  // Alternating [paragraph, separator, paragraph, separator, …]; dropping a
  // duplicate paragraph also drops the blank-line separator that precedes it so
  // no double gap is left behind.
  const tokens = prose.split(/(\n\s*\n)/);
  const kept: string[] = [];
  let previousKey: string | null = null;
  for (const token of tokens) {
    if (isSeparator(token)) {
      kept.push(token);
      continue;
    }
    const key = normalize(token);
    if (key === previousKey) {
      while (kept.length > 0 && isSeparator(kept[kept.length - 1])) {
        kept.pop();
      }
      continue;
    }
    kept.push(collapseSentenceRepeats(token));
    previousKey = key;
  }
  return kept.join('');
}

/** Collapses consecutive identical sentences within a single paragraph to one. */
function collapseSentenceRepeats(paragraph: string): string {
  const leading = paragraph.match(/^\s*/)?.[0] ?? '';
  const trailing = paragraph.match(/\s*$/)?.[0] ?? '';
  const body = paragraph.slice(leading.length, paragraph.length - trailing.length);
  const sentences = body.match(/[^.!?…]*[.!?…]+(?=\s|$)|[^.!?…]+$/g);
  if (sentences === null || sentences.length < 2) {
    return paragraph;
  }
  const kept = dropConsecutiveDuplicates(
    sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence !== ''),
    (sentence) => normalize(sentence),
  );
  return `${leading}${kept.join(' ')}${trailing}`;
}

/** Keeps the first of each run of items whose key (when non-null) equals the previous. */
function dropConsecutiveDuplicates<T>(items: T[], keyOf: (item: T) => string | null): T[] {
  const result: T[] = [];
  let previousKey: string | null = null;
  for (const item of items) {
    const key = keyOf(item);
    if (key !== null && key === previousKey) {
      continue;
    }
    result.push(item);
    if (key !== null) {
      previousKey = key;
    }
  }
  return result;
}

function isSeparator(segment: string): boolean {
  return segment.trim() === '';
}

function normalize(segment: string): string {
  return segment.trim().replace(/\s+/g, ' ');
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
