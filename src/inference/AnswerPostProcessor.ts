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
  const text = tailCollapsed.text;
  if (deduped.changed || tailCollapsed.changed) {
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
    changed = changed || collapsed.changed;
    return collapsed.text;
  });
  return { text: rebuilt.join(''), changed };
}

/** De-duplicates consecutive identical paragraphs, then consecutive identical sentences. */
function collapseProseRepeats(prose: string): DedupResult {
  if (prose.trim() === '') {
    return { text: prose, changed: false };
  }
  const cycleCollapsed = collapseRepeatedSentenceCycle(prose);
  const paragraphCollapsed = collapseConsecutiveUnits(
    cycleCollapsed.text,
    findParagraphUnits(cycleCollapsed.text),
  );
  const sentenceCollapsed = collapseSentenceRepeats(paragraphCollapsed.text);
  return {
    text: sentenceCollapsed.text,
    changed: cycleCollapsed.changed || paragraphCollapsed.changed || sentenceCollapsed.changed,
  };
}

/**
 * Finds a normalized 2-4 sentence block repeated three consecutive times anywhere
 * in prose and removes only the surplus repeated source spans.
 */
function collapseRepeatedSentenceCycle(prose: string): DedupResult {
  const sentences = findSentenceUnits(prose);
  for (let start = 0; start < sentences.length; start += 1) {
    for (let blockLength = 2; blockLength <= 4; blockLength += 1) {
      if (start + blockLength * MIN_LOOP_REPEATS > sentences.length) {
        continue;
      }
      const block = sentences.slice(start, start + blockLength).map((unit) => unit.cycleKey);
      let repeatCount = 1;
      while (
        start + blockLength * (repeatCount + 1) <= sentences.length &&
        sentenceBlockMatches(sentences, start + blockLength * repeatCount, block)
      ) {
        repeatCount += 1;
      }
      if (repeatCount >= MIN_LOOP_REPEATS) {
        const firstSurplus = sentences[start + blockLength];
        const lastRepeated = sentences[start + blockLength * repeatCount - 1];
        return removeSpans(prose, [{
          start: firstSurplus.start,
          end: lastRepeated.end,
        }]);
      }
    }
  }
  return { text: prose, changed: false };
}

interface SourceUnit {
  readonly start: number;
  readonly end: number;
  readonly key: string;
  readonly cycleKey: string;
}

interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

function sentenceBlockMatches(
  sentences: readonly SourceUnit[],
  start: number,
  expected: readonly string[],
): boolean {
  return expected.every((key, offset) => sentences[start + offset]?.cycleKey === key);
}

/** Collapses consecutive identical sentences within a single paragraph to one. */
function collapseSentenceRepeats(prose: string): DedupResult {
  return collapseConsecutiveUnits(prose, findSentenceUnits(prose));
}

function findSentenceUnits(prose: string): SourceUnit[] {
  const units: SourceUnit[] = [];
  const pattern = /[^.!?…]*[.!?…]+(?=\s|$)|[^.!?…]+$/g;
  for (const match of prose.matchAll(pattern)) {
    const value = match[0];
    const key = normalize(value);
    if (key !== '') {
      const start = match.index;
      units.push({
        start,
        end: start + value.length,
        key,
        cycleKey: key.toLocaleLowerCase(),
      });
    }
  }
  return units;
}

function findParagraphUnits(prose: string): SourceUnit[] {
  const units: SourceUnit[] = [];
  const separator = /\n\s*\n/g;
  let start = 0;
  for (const match of prose.matchAll(separator)) {
    appendSourceUnit(units, prose, start, match.index);
    start = match.index + match[0].length;
  }
  appendSourceUnit(units, prose, start, prose.length);
  return units;
}

function appendSourceUnit(
  units: SourceUnit[],
  source: string,
  start: number,
  end: number,
): void {
  const key = normalize(source.slice(start, end));
  if (key !== '') {
    units.push({ start, end, key, cycleKey: key.toLocaleLowerCase() });
  }
}

function collapseConsecutiveUnits(text: string, units: readonly SourceUnit[]): DedupResult {
  const removals: SourceSpan[] = [];
  let runStart = 0;
  while (runStart < units.length) {
    let runEnd = runStart + 1;
    while (runEnd < units.length && units[runEnd].key === units[runStart].key) {
      runEnd += 1;
    }
    if (runEnd - runStart >= MIN_LOOP_REPEATS) {
      removals.push({
        start: units[runStart].end,
        end: units[runEnd - 1].end,
      });
    }
    runStart = runEnd;
  }
  return removeSpans(text, removals);
}

function removeSpans(text: string, spans: readonly SourceSpan[]): DedupResult {
  if (spans.length === 0) {
    return { text, changed: false };
  }
  let result = text;
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index];
    result = result.slice(0, span.start) + result.slice(span.end);
  }
  return { text: result, changed: true };
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
 * and returns the original text with only surplus source spans dropped.
 */
function collapseLoopingTail(text: string): DedupResult {
  const parts = text.split(CODE_FENCE);
  const tailIndex = parts.length - 1;
  if (parts[tailIndex].startsWith('```')) {
    return { text, changed: false };
  }
  const collapsed = collapseProseLoopingTail(parts[tailIndex]);
  if (!collapsed.changed) {
    return { text, changed: false };
  }
  parts[tailIndex] = collapsed.text;
  return { text: parts.join(''), changed: true };
}

function collapseProseLoopingTail(text: string): DedupResult {
  const words = [...text.matchAll(/\S+/g)].map((match) => ({
    value: match[0],
    start: match.index,
  }));

  for (let phraseLength = MAX_LOOP_PHRASE_WORDS; phraseLength >= 1; phraseLength -= 1) {
    if (words.length < phraseLength * MIN_LOOP_REPEATS) {
      continue;
    }

    const phrase = words.slice(-phraseLength).map((word) => word.value).join(' ');
    let repeats = 1;
    while (
      words.length >= phraseLength * (repeats + 1) &&
      words
        .slice(-phraseLength * (repeats + 1), -phraseLength * repeats)
        .map((word) => word.value)
        .join(' ') === phrase
    ) {
      repeats += 1;
    }

    if (repeats >= MIN_LOOP_REPEATS) {
      const firstSurplus = words.length - phraseLength * (repeats - 1);
      return {
        text: text.slice(0, words[firstSurplus].start).trimEnd(),
        changed: true,
      };
    }
  }

  return { text, changed: false };
}
