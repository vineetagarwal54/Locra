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
      readonly start?: number;
      readonly items: MarkdownListItem[];
    };

export interface MarkdownListItem {
  readonly spans: InlineSpan[];
  readonly children: MarkdownBlock[];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };
  const flushAll = (): void => {
    flushParagraph();
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
      const parsedList = parseList(lines, index);
      blocks.push(parsedList.block);
      index = parsedList.nextIndex - 1;
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

interface ParsedList {
  readonly block: MarkdownBlock & { readonly type: 'list' };
  readonly nextIndex: number;
}

function parseList(lines: string[], startIndex: number): ParsedList {
  const firstMatch = lines[startIndex].match(LIST_ITEM);
  if (firstMatch === null) {
    throw new Error('Expected a Markdown list item.');
  }

  const baseIndent = firstMatch[1].length;
  const ordered = /^\d/.test(firstMatch[2]);
  const items: MarkdownListItem[] = [];
  let index = startIndex;
  let listStart: number | undefined;

  while (index < lines.length) {
    const match = lines[index].match(LIST_ITEM);
    if (match === null || match[1].length !== baseIndent) {
      break;
    }

    const itemIsOrdered = /^\d/.test(match[2]);
    if (itemIsOrdered !== ordered) {
      break;
    }

    if (listStart === undefined && ordered) {
      listStart = Number.parseInt(match[2], 10);
    }

    const item: MarkdownListItem = { spans: parseInline(match[3].trim()), children: [] };
    index += 1;

    const nested = lines[index]?.match(LIST_ITEM);
    if (nested !== undefined && nested !== null && nested[1].length > baseIndent) {
      const parsedNested = parseList(lines, index);
      item.children.push(parsedNested.block);
      index = parsedNested.nextIndex;
    }

    items.push(item);
  }

  return {
    block: { type: 'list', ordered, ...(listStart === undefined ? {} : { start: listStart }), items },
    nextIndex: index,
  };
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
