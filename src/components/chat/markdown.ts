// Minimal, dependency-free Markdown parser for assistant output. Pure (no RN
// imports) so it is unit-testable and can run at render time. Supports the subset
// a small model actually emits — headings, bold, italic, inline code, fenced code
// blocks, and bullet/ordered lists — and degrades safely on INCOMPLETE input
// (an unclosed ``` fence or dangling **) so streaming never shows a broken block.

export interface InlineSpan {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly code?: boolean;
}

export type MarkdownBlock =
  | { readonly type: 'heading'; readonly level: number; readonly spans: InlineSpan[] }
  | { readonly type: 'paragraph'; readonly spans: InlineSpan[] }
  | { readonly type: 'code'; readonly content: string }
  | {
      readonly type: 'list';
      readonly ordered: boolean;
      readonly items: InlineSpan[][];
    };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```/;

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list !== null) {
      blocks.push({
        type: 'list',
        ordered: list.ordered,
        items: list.items.map((item) => parseInline(item)),
      });
      list = null;
    }
  };
  const flushAll = (): void => {
    flushParagraph();
    flushList();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (FENCE.test(line)) {
      // Collect until the closing fence — or end of input, so a still-streaming
      // block renders as code immediately instead of leaking literal backticks.
      flushAll();
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'code', content: content.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      flushAll();
      continue;
    }

    const heading = line.match(HEADING);
    if (heading !== null) {
      flushAll();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        spans: parseInline(heading[2].trim()),
      });
      continue;
    }

    const bullet = line.match(BULLET);
    const ordered = line.match(ORDERED);
    if (bullet !== null || ordered !== null) {
      flushParagraph();
      const isOrdered = ordered !== null;
      const itemText = (isOrdered ? ordered![1] : bullet![1]).trim();
      if (list === null || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(itemText);
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushAll();
  return blocks;
}

/**
 * Splits a line into styled spans. Inline code binds tightest, then bold (`**`),
 * then italic (`*`/`_`). An unmatched marker is emitted as literal text so
 * partially-streamed emphasis never throws.
 */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (buffer !== '') {
      spans.push({ text: buffer });
      buffer = '';
    }
  };

  while (index < text.length) {
    const rest = text.slice(index);

    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end !== -1) {
        flush();
        spans.push({ text: text.slice(index + 1, end), code: true });
        index = end + 1;
        continue;
      }
    }

    if (rest.startsWith('**')) {
      const end = text.indexOf('**', index + 2);
      if (end !== -1 && end > index + 2) {
        flush();
        for (const inner of parseEmphasis(text.slice(index + 2, end))) {
          spans.push({ ...inner, bold: true });
        }
        index = end + 2;
        continue;
      }
    }

    if (text[index] === '*' || text[index] === '_') {
      const marker = text[index];
      const end = text.indexOf(marker, index + 1);
      if (end !== -1 && end > index + 1) {
        flush();
        spans.push({ text: text.slice(index + 1, end), italic: true });
        index = end + 1;
        continue;
      }
    }

    buffer += text[index];
    index += 1;
  }

  flush();
  return spans;
}

/** Second pass used inside bold runs so `**bold _and italic_**` keeps both. */
function parseEmphasis(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let buffer = '';
  let index = 0;
  const flush = (): void => {
    if (buffer !== '') {
      spans.push({ text: buffer });
      buffer = '';
    }
  };
  while (index < text.length) {
    if (text[index] === '*' || text[index] === '_') {
      const marker = text[index];
      const end = text.indexOf(marker, index + 1);
      if (end !== -1 && end > index + 1) {
        flush();
        spans.push({ text: text.slice(index + 1, end), italic: true });
        index = end + 1;
        continue;
      }
    }
    buffer += text[index];
    index += 1;
  }
  flush();
  return spans;
}
