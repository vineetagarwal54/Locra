import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { designTokens, haptics } from '../../constants/theme';
import type { ConversationMessage } from '../../types/models';

import { AssistantIdentityRow } from './AssistantIdentityRow';
import { ImagePromptCard } from './ImagePromptCard';
import { MarkdownText } from './MarkdownText';
import { copyText, shareText } from './MessageActions';
import { StreamingMessage } from './StreamingMessage';

interface MessageBubbleProps {
  message: ConversationMessage;
  streamingText?: string;
  onRetry?: (assistantMessageId: string) => void;
  onRegenerate?: (assistantMessageId: string) => void;
  onContinue?: (assistantMessageId: string) => void;
  onReportIssue?: (assistantMessageId: string) => void;
}

interface ActionSpec {
  readonly label: string;
  readonly hint?: string;
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

export function MessageBubble({
  message,
  streamingText = '',
  onRetry,
  onRegenerate,
  onContinue,
  onReportIssue,
}: MessageBubbleProps) {
  if (message.role === 'user') {
    return <UserMessage message={message} />;
  }

  return (
    <AssistantMessage
      message={message}
      streamingText={streamingText}
      onRetry={onRetry}
      onRegenerate={onRegenerate}
      onContinue={onContinue}
      onReportIssue={onReportIssue}
    />
  );
}

function UserMessage({ message }: { message: ConversationMessage }) {
  const imageAttachment = message.attachments.find((attachment) => attachment.kind === 'image');
  return (
    <View testID="user-message-group" style={styles.userWrap}>
      {imageAttachment === undefined ? (
        <View testID="user-message-card" style={styles.userBubble}>
          <Text selectable style={styles.userText}>{message.text}</Text>
        </View>
      ) : (
        <ImagePromptCard
          imagePath={imageAttachment.path}
          question={message.text}
          available={imageAttachment.available}
          compact
        />
      )}
      <CopyShareActions text={message.text} alignment="right" />
    </View>
  );
}

function AssistantMessage({
  message,
  streamingText,
  onRetry,
  onRegenerate,
  onContinue,
  onReportIssue,
}: Required<Pick<MessageBubbleProps, 'message' | 'streamingText'>> &
  Pick<MessageBubbleProps, 'onRetry' | 'onRegenerate' | 'onContinue' | 'onReportIssue'>) {
  const text = message.status === 'generating' ? streamingText : message.text;
  const isTruncated = message.status === 'completed' && message.finishReason === 'length';
  const isFailed = message.status === 'failed';
  const isInterrupted = message.status === 'interrupted';

  return (
    <View style={styles.assistantWrap}>
      <View
        testID="assistant-message-card"
        style={[styles.assistantBubble, isFailed && styles.failedBubble]}
      >
        <AssistantIdentityRow />
        {isFailed ? <FailureHeader /> : null}
        {message.status === 'generating' && text.trim() === '' ? (
          <StreamingMessage />
        ) : text.trim() !== '' ? (
          <MarkdownText text={text} />
        ) : null}
        {isFailed ? (
          <Text style={styles.statusText}>
            {message.errorMessage ?? 'Locra could not finish that answer.'}
          </Text>
        ) : null}
        {isInterrupted ? <Text style={styles.statusText}>This response was stopped.</Text> : null}
        {isTruncated ? (
          <Text style={styles.statusText}>This answer was cut off at the length limit.</Text>
        ) : null}
        {message.status !== 'generating' ? (
          <AssistantActionRow
            message={message}
            text={text}
            onRetry={onRetry}
            onRegenerate={onRegenerate}
            onContinue={onContinue}
            onReportIssue={onReportIssue}
          />
        ) : null}
      </View>
    </View>
  );
}

function FailureHeader() {
  return (
    <View style={styles.failedHeader}>
      <MaterialCommunityIcons name="alert-circle-outline" size={18} color={designTokens.color.error} />
      <Text style={styles.failedTitle}>Response failed</Text>
    </View>
  );
}

function AssistantActionRow({
  message,
  text,
  onRetry,
  onRegenerate,
  onContinue,
  onReportIssue,
}: Pick<MessageBubbleProps, 'onRetry' | 'onRegenerate' | 'onContinue' | 'onReportIssue'> & {
  message: ConversationMessage;
  text: string;
}) {
  const [state, setState] = useState<'idle' | 'copying' | 'sharing' | 'copied' | 'failed'>('idle');
  const busy = state === 'copying' || state === 'sharing';
  const actions: ActionSpec[] = [];

  if ((message.status === 'failed' || message.status === 'interrupted') && onRetry !== undefined) {
    actions.push({
      label: 'Retry response',
      hint: 'Starts a new response attempt.',
      icon: 'refresh',
      onPress: () => onRetry(message.id),
    });
  } else if (message.status === 'completed' && onRegenerate !== undefined) {
    actions.push({
      label: 'Regenerate response',
      hint: 'Creates a new answer while preserving this attempt.',
      icon: 'refresh',
      onPress: () => onRegenerate(message.id),
    });
  }
  if (onReportIssue !== undefined) {
    actions.push({
      label: 'Report issue',
      hint: 'Opens diagnostics for this response.',
      icon: 'flag-outline',
      onPress: () => onReportIssue(message.id),
    });
  }
  if (text.trim() !== '') {
    actions.push(copyAction(text, state, busy, setState), shareAction(text, busy, setState));
  }
  if (message.finishReason === 'length' && onContinue !== undefined) {
    actions.push({
      label: 'Continue response',
      hint: 'Continues this length-limited answer.',
      icon: 'arrow-right-circle-outline',
      onPress: () => onContinue(message.id),
    });
  }

  return <IconActionRow actions={actions} failed={state === 'failed'} alignment="left" />;
}

function CopyShareActions({ text, alignment }: { text: string; alignment: 'left' | 'right' }) {
  const [state, setState] = useState<'idle' | 'copying' | 'sharing' | 'copied' | 'failed'>('idle');
  if (text.trim() === '') return null;
  const busy = state === 'copying' || state === 'sharing';
  return (
    <IconActionRow
      actions={[copyAction(text, state, busy, setState), shareAction(text, busy, setState)]}
      failed={state === 'failed'}
      alignment={alignment}
    />
  );
}

function copyAction(
  text: string,
  state: string,
  busy: boolean,
  setState: (state: 'idle' | 'copying' | 'sharing' | 'copied' | 'failed') => void,
): ActionSpec {
  return {
    label: state === 'copied' ? 'Message copied' : 'Copy message',
    hint: 'Copies the message text to the clipboard.',
    icon: state === 'copied' ? 'check' : 'content-copy',
    disabled: busy,
    onPress: () => { void runTextAction('copy', text, setState); },
  };
}

function shareAction(
  text: string,
  busy: boolean,
  setState: (state: 'idle' | 'copying' | 'sharing' | 'copied' | 'failed') => void,
): ActionSpec {
  return {
    label: 'Share message',
    hint: 'Opens the system share sheet.',
    icon: 'share-variant-outline',
    disabled: busy,
    onPress: () => { void runTextAction('share', text, setState); },
  };
}

async function runTextAction(
  kind: 'copy' | 'share',
  text: string,
  setState: (state: 'idle' | 'copying' | 'sharing' | 'copied' | 'failed') => void,
): Promise<void> {
  setState(kind === 'copy' ? 'copying' : 'sharing');
  try {
    if (kind === 'copy') {
      await copyText(text);
      setState('copied');
    } else {
      await shareText(text);
      setState('idle');
    }
  } catch {
    setState('failed');
  }
}

function IconActionRow({
  actions,
  failed,
  alignment,
}: {
  actions: readonly ActionSpec[];
  failed: boolean;
  alignment: 'left' | 'right';
}) {
  if (actions.length === 0) return null;
  return (
    <View
      testID={alignment === 'right' ? 'user-message-actions' : 'assistant-message-actions'}
      style={[styles.actionRow, alignment === 'right' && styles.actionRowRight]}
    >
      {actions.map((action) => (
        <IconActionButton key={action.label} action={action} />
      ))}
      {failed ? <Text style={styles.actionError}>Action failed</Text> : null}
    </View>
  );
}

function IconActionButton({ action }: { action: ActionSpec }) {
  const disabled = action.disabled ?? false;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityHint={action.hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        pressed && !disabled && styles.actionButtonPressed,
        disabled && styles.actionButtonDisabled,
      ]}
      onPress={() => {
        void haptics.tap();
        action.onPress();
      }}
    >
      <MaterialCommunityIcons
        name={action.icon}
        size={18}
        color={designTokens.color.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userWrap: {
    alignItems: 'flex-end',
    marginBottom: designTokens.spacing.space12,
  },
  assistantWrap: {
    alignItems: 'flex-start',
    marginBottom: designTokens.spacing.space12,
  },
  userBubble: {
    maxWidth: '86%',
    paddingHorizontal: designTokens.spacing.space16,
    paddingVertical: designTokens.spacing.space12,
    borderRadius: designTokens.radius.bubble,
    borderBottomRightRadius: designTokens.radius.bubbleTail,
    backgroundColor: designTokens.color.primarySoft,
  },
  userText: {
    color: designTokens.color.onUserBubble,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
  },
  assistantBubble: {
    maxWidth: '92%',
    paddingHorizontal: designTokens.spacing.space16,
    paddingTop: designTokens.spacing.space8,
    paddingBottom: designTokens.spacing.space4,
    borderRadius: designTokens.radius.bubble,
    borderBottomLeftRadius: designTokens.radius.bubbleTail,
    backgroundColor: designTokens.color.surfaceStrong,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  statusText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
    marginTop: designTokens.spacing.space8,
  },
  failedBubble: {
    borderColor: designTokens.color.error,
    backgroundColor: designTokens.color.errorSurface,
  },
  failedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: designTokens.spacing.space8,
  },
  failedTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.bodyStrong.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    marginLeft: designTokens.spacing.space8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexWrap: 'wrap',
    marginTop: designTokens.spacing.space4,
    // columnGap: designTokens.spacing.space4,
  },
  actionRowRight: {
    alignSelf: 'flex-end',
  },
  actionButton: {
    width: designTokens.spacing.space24 + designTokens.spacing.space4,
    height: designTokens.spacing.space24 + designTokens.spacing.space20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
  },
  actionButtonPressed: {
    backgroundColor: designTokens.color.divider,
    transform: [{ scale: 0.96 }],
  },
  actionButtonDisabled: {
    opacity: 0.4,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  actionError: {
    color: designTokens.color.error,
    fontSize: designTokens.type.caption.fontSize,
  },
});
