import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { designTokens } from '../../constants/theme';

import { parseMarkdown, type InlineSpan, type MarkdownBlock } from './markdown';

interface MarkdownTextProps {
  readonly text: string;
}

// Renders assistant output as styled Markdown so headings, bold, lists, inline
// code, and code blocks read as formatting instead of raw `###`/`**`/backticks.
// User messages stay plain (they don't use this component).
export function MarkdownText({ text }: MarkdownTextProps) {
  const blocks = parseMarkdown(text);
  return (
    <View>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} isFirst={index === 0} />
      ))}
    </View>
  );
}

function BlockView({ block, isFirst }: { block: MarkdownBlock; isFirst: boolean }) {
  const spacing = isFirst ? undefined : styles.blockGap;

  if (block.type === 'heading') {
    return (
      <Text style={[headingStyle(block.level), spacing]}>
        <InlineSpans spans={block.spans} />
      </Text>
    );
  }

  if (block.type === 'code') {
    return (
      <View style={[styles.codeBlock, spacing]}>
        <Text style={styles.codeBlockText}>{block.content}</Text>
      </View>
    );
  }

  if (block.type === 'list') {
    return (
      <View style={spacing}>
        {block.items.map((item, index) => (
          <View key={index} style={styles.listItem}>
            <Text style={styles.listMarker}>
              {block.ordered ? `${index + 1}.` : '•'}
            </Text>
            <Text style={styles.listItemText}>
              <InlineSpans spans={item} />
            </Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <Text style={[styles.paragraph, spacing]}>
      <InlineSpans spans={block.spans} />
    </Text>
  );
}

function InlineSpans({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((span, index) => (
        <Fragment key={index}>{renderSpan(span)}</Fragment>
      ))}
    </>
  );
}

function renderSpan(span: InlineSpan) {
  if (span.code === true) {
    return <Text style={styles.inlineCode}>{span.text}</Text>;
  }
  const style = [
    span.bold === true ? styles.bold : null,
    span.italic === true ? styles.italic : null,
  ];
  return <Text style={style}>{span.text}</Text>;
}

function headingStyle(level: number) {
  if (level <= 1) {
    return styles.heading1;
  }
  if (level === 2) {
    return styles.heading2;
  }
  return styles.heading3;
}

const styles = StyleSheet.create({
  blockGap: {
    marginTop: designTokens.spacing.space8,
  },
  paragraph: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
  },
  heading1: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.sectionTitle.fontSize,
    fontWeight: designTokens.type.sectionTitle.fontWeight,
    lineHeight: designTokens.type.sectionTitle.lineHeight,
  },
  heading2: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.cardTitle.fontSize,
    fontWeight: designTokens.type.cardTitle.fontWeight,
    lineHeight: designTokens.type.cardTitle.lineHeight,
  },
  heading3: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.bodyStrong.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    lineHeight: designTokens.type.bodyStrong.lineHeight,
  },
  bold: {
    fontWeight: designTokens.type.bodyStrong.fontWeight,
  },
  italic: {
    fontStyle: 'italic',
  },
  inlineCode: {
    fontFamily: 'monospace',
    fontSize: designTokens.type.supporting.fontSize,
    color: designTokens.color.primary,
    backgroundColor: designTokens.color.surface,
  },
  codeBlock: {
    padding: designTokens.spacing.space12,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  codeBlockText: {
    fontFamily: 'monospace',
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
    color: designTokens.color.textPrimary,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: designTokens.spacing.space4,
  },
  listMarker: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
    marginRight: designTokens.spacing.space8,
    minWidth: designTokens.spacing.space16,
  },
  listItemText: {
    flex: 1,
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
  },
});
