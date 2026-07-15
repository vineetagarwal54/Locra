import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { designTokens } from '../../constants/theme';

import { parseMarkdown, type InlineSpan, type MarkdownBlock } from './markdown';
import { copyText } from './MessageActions';

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
      <Text selectable style={[headingStyle(block.level), spacing]}>
        <InlineSpans spans={block.spans} />
      </Text>
    );
  }

  if (block.type === 'code') {
    return (
      <CodeBlock content={block.content} spacing={spacing} />
    );
  }

  if (block.type === 'list') {
    return (
      <View style={spacing}>
        <ListView block={block} />
      </View>
    );
  }

  return (
    <Text selectable style={[styles.paragraph, spacing]}>
      <InlineSpans spans={block.spans} />
    </Text>
  );
}

function ListView({ block }: { block: MarkdownBlock & { readonly type: 'list' } }) {
  return (
    <View>
      {block.items.map((item, index) => (
        <View key={index} style={styles.listItem}>
          <Text style={styles.listMarker}>
            {block.ordered ? `${(block.start ?? 1) + index}.` : '•'}
          </Text>
          <View style={styles.listItemContent}>
            <Text selectable style={styles.listItemText}>
              <InlineSpans spans={item.spans} />
            </Text>
            {item.children.map((child, childIndex) =>
              child.type === 'list' ? (
                <View key={childIndex} style={styles.nestedList}>
                  <ListView block={child} />
                </View>
              ) : null
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

function CodeBlock({ content, spacing }: { content: string; spacing: object | undefined }) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const copying = state === 'copying';
  const onCopy = async (): Promise<void> => {
    if (copying) return;
    setState('copying');
    try {
      await copyText(content);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <View style={[styles.codeBlock, spacing]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy code"
        disabled={copying}
        style={({ pressed }) => [styles.copyCode, pressed && styles.copyCodePressed, copying && styles.copyCodeDisabled]}
        onPress={() => { void onCopy(); }}
      >
        <Text style={styles.copyCodeText}>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Try again' : 'Copy Code'}</Text>
      </Pressable>
      <Text selectable style={styles.codeBlockText}>{content}</Text>
    </View>
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
  copyCode: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' },
  copyCodePressed: { opacity: 0.7 },
  copyCodeDisabled: { opacity: 0.45 },
  copyCodeText: { color: designTokens.color.primary, fontSize: designTokens.type.caption.fontSize, fontWeight: designTokens.type.caption.fontWeight },
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
  listItemContent: {
    flex: 1,
  },
  nestedList: {
    marginTop: designTokens.spacing.space4,
  },
});
