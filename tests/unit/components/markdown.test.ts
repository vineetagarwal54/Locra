import { parseInline, parseMarkdown } from '../../../src/components/chat/markdown';

describe('markdown parser', () => {
  it('parses headings without leaking the hashes', () => {
    expect(parseMarkdown('# Title')).toEqual([
      { type: 'heading', level: 1, spans: [{ text: 'Title' }] },
    ]);
    expect(parseMarkdown('### Sub')[0]).toEqual({
      type: 'heading',
      level: 3,
      spans: [{ text: 'Sub' }],
    });
  });

  it('parses bold, italic, and inline code spans', () => {
    expect(parseInline('a **b** c')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c' },
    ]);
    expect(parseInline('an _emphasis_ word')).toEqual([
      { text: 'an ' },
      { text: 'emphasis', italic: true },
      { text: ' word' },
    ]);
    expect(parseInline('run `npm test` now')).toEqual([
      { text: 'run ' },
      { text: 'npm test', code: true },
      { text: ' now' },
    ]);
  });

  it('preserves ordered list numbering and nested list structure', () => {
    expect(parseMarkdown('- one\n- two')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [
          { spans: [{ text: 'one' }], children: [] },
          { spans: [{ text: 'two' }], children: [] },
        ],
      },
    ]);
    expect(parseMarkdown('1. first\n2. second')).toEqual([
      {
        type: 'list',
        ordered: true,
        start: 1,
        items: [
          { spans: [{ text: 'first' }], children: [] },
          { spans: [{ text: 'second' }], children: [] },
        ],
      },
    ]);
    expect(parseMarkdown('3. Third\n4. Fourth')).toEqual([
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [
          { spans: [{ text: 'Third' }], children: [] },
          { spans: [{ text: 'Fourth' }], children: [] },
        ],
      },
    ]);
    expect(parseMarkdown('1. Parent\n   3. Nested\n   4. Nested again\n2. Sibling')).toEqual([
      {
        type: 'list',
        ordered: true,
        start: 1,
        items: [
          {
            spans: [{ text: 'Parent' }],
            children: [
              {
                type: 'list',
                ordered: true,
                start: 3,
                items: [
                  { spans: [{ text: 'Nested' }], children: [] },
                  { spans: [{ text: 'Nested again' }], children: [] },
                ],
              },
            ],
          },
          { spans: [{ text: 'Sibling' }], children: [] },
        ],
      },
    ]);
  });

  it('parses a fenced code block and keeps its content verbatim', () => {
    expect(parseMarkdown('```\nline1\nline2\n```')).toEqual([
      { type: 'code', content: 'line1\nline2' },
    ]);
  });

  it('renders an unclosed code fence as a code block while streaming', () => {
    // No closing ``` yet — must NOT leak the literal backticks.
    expect(parseMarkdown('```js\nconst x = 1')).toEqual([
      { type: 'code', content: 'const x = 1' },
    ]);
  });

  it('treats a dangling emphasis marker as literal text (safe streaming)', () => {
    expect(() => parseInline('hello **wor')).not.toThrow();
    expect(parseInline('hello **wor')).toEqual([{ text: 'hello **wor' }]);
  });

  it('separates paragraphs on blank lines', () => {
    expect(parseMarkdown('First para.\n\nSecond para.')).toEqual([
      { type: 'paragraph', spans: [{ text: 'First para.' }] },
      { type: 'paragraph', spans: [{ text: 'Second para.' }] },
    ]);
  });
});
