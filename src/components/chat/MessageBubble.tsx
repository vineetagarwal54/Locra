import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { designTokens, haptics } from '../../constants/theme';
import type { ConversationMessage } from '../../types/models';

import { ImagePromptCard } from './ImagePromptCard';
import { MarkdownText } from './MarkdownText';
import { copyText, shareText } from './MessageActions';
import { StreamingMessage } from './StreamingMessage';

interface MessageBubbleProps {
  message: ConversationMessage;
  streamingText?: string;
  onRetry?: (assistantMessageId: string) => void;
  onReportIssue?: (assistantMessageId: string) => void;
}

export function MessageBubble({
  message,
  streamingText = '',
  onRetry,
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
      onReportIssue={onReportIssue}
    />
  );
}

function UserMessage({ message }: { message: ConversationMessage }) {
  const imageAttachment = message.attachments.find((attachment) => attachment.kind === 'image');
  if (imageAttachment !== undefined) {
    return (
      <View style={styles.userWrap}>
        <ImagePromptCard
          imagePath={imageAttachment.path}
          question={message.text}
          available={imageAttachment.available}
        />
        <MessageActionRow text={message.text} />
      </View>
    );
  }

  return (
    <View style={styles.userWrap}>
      <View style={styles.userBubble}>
        <Text selectable style={styles.userText}>{message.text}</Text>
      </View>
      <MessageActionRow text={message.text} />
    </View>
  );
}

function AssistantMessage({
  message,
  streamingText,
  onRetry,
  onReportIssue,
}: {
  message: ConversationMessage;
  streamingText: string;
  onRetry?: (assistantMessageId: string) => void;
  onReportIssue?: (assistantMessageId: string) => void;
}) {
  const text = message.status === 'generating' ? streamingText : message.text;

  if (message.status === 'failed') {
    return (
      <View style={styles.assistantWrap}>
        <View style={[styles.assistantBubble, styles.failedBubble]}>
          <View style={styles.failedHeader}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={18}
              color={designTokens.color.error}
            />
            <Text style={styles.failedTitle}>Response failed</Text>
          </View>
          {text.trim() !== '' ? <MarkdownText text={text} /> : null}
          <Text style={styles.failedText}>
            {message.errorMessage ?? 'Locra could not finish that answer.'}
          </Text>
          {onRetry !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry failed response"
              style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
              onPress={() => {
                void haptics.tap();
                onRetry(message.id);
              }}
            >
              <Text style={styles.retryButtonLabel}>Retry</Text>
            </Pressable>
          ) : null}
          <ReportIssueButton messageId={message.id} onReportIssue={onReportIssue} />
          <MessageActionRow text={text} />
        </View>
      </View>
    );
  }

  if (message.status === 'interrupted') {
    return (
      <View style={styles.assistantWrap}>
        <View style={styles.assistantBubble}>
          {text.trim() !== '' ? <MarkdownText text={text} /> : null}
          <Text style={styles.assistantMuted}>This response was stopped.</Text>
          {onRetry !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry interrupted response"
              style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
              onPress={() => {
                void haptics.tap();
                onRetry(message.id);
              }}
            >
              <Text style={styles.retryButtonLabel}>Retry</Text>
            </Pressable>
          ) : null}
          <ReportIssueButton messageId={message.id} onReportIssue={onReportIssue} />
          <MessageActionRow text={text} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantWrap}>
      <View style={styles.assistantBubble}>
        {message.status === 'generating' && text.trim() === '' ? (
          <StreamingMessage />
        ) : (
          <MarkdownText text={text} />
        )}
        {message.status !== 'generating' ? (
          <>
            <ReportIssueButton messageId={message.id} onReportIssue={onReportIssue} />
            <MessageActionRow text={text} />
          </>
        ) : null}
      </View>
    </View>
  );
}

function MessageActionRow({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copying' | 'sharing' | 'copied' | 'failed'>('idle');
  const busy = state === 'copying' || state === 'sharing';

  const run = async (kind: 'copy' | 'share'): Promise<void> => {
    if (busy) return;
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
  };

  if (text.trim() === '') return null;
  return (
    <View style={styles.messageActions}>
      <MessageActionButton
        label={state === 'copied' ? 'Copied' : 'Copy'}
        icon={state === 'copied' ? 'check' : 'content-copy'}
        disabled={busy}
        onPress={() => { void run('copy'); }}
      />
      <MessageActionButton
        label="Share"
        icon="share-variant-outline"
        disabled={busy}
        onPress={() => { void run('share'); }}
      />
      {state === 'failed' ? <Text style={styles.actionError}>Action failed</Text> : null}
    </View>
  );
}

function MessageActionButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} message`}
      disabled={disabled}
      style={({ pressed }) => [styles.messageAction, pressed && styles.retryButtonPressed, disabled && styles.actionDisabled]}
      onPress={onPress}
    >
      <MaterialCommunityIcons name={icon} size={15} color={designTokens.color.textSecondary} />
      <Text style={styles.messageActionLabel}>{label}</Text>
    </Pressable>
  );
}

function ReportIssueButton({
  messageId,
  onReportIssue,
}: {
  messageId: string;
  onReportIssue?: (assistantMessageId: string) => void;
}) {
  if (onReportIssue === undefined) {
    return null;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Report issue with this response"
      style={({ pressed }) => [styles.reportButton, pressed && styles.retryButtonPressed]}
      onPress={() => {
        void haptics.tap();
        onReportIssue(messageId);
      }}
    >
      <MaterialCommunityIcons name="flag-outline" size={16} color={designTokens.color.textSecondary} />
      <Text style={styles.reportButtonLabel}>Report issue</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userWrap: {
    alignItems: 'flex-end',
    marginBottom: designTokens.spacing.space16,
  },
  assistantWrap: {
    alignItems: 'flex-start',
    marginBottom: designTokens.spacing.space16,
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
    paddingVertical: designTokens.spacing.space12,
    borderRadius: designTokens.radius.bubble,
    borderBottomLeftRadius: designTokens.radius.bubbleTail,
    backgroundColor: designTokens.color.surfaceStrong,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  assistantMuted: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
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
  failedText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: designTokens.spacing.space12,
    paddingVertical: designTokens.spacing.space8,
    paddingHorizontal: designTokens.spacing.space16,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.primary,
  },
  retryButtonPressed: {
    opacity: 0.85,
  },
  retryButtonLabel: {
    color: designTokens.color.onPrimary,
    fontSize: designTokens.type.button.fontSize,
    fontWeight: designTokens.type.button.fontWeight,
  },
  reportButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: designTokens.spacing.space12,
    minHeight: 44,
  },
  reportButtonLabel: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    marginLeft: designTokens.spacing.space4,
  },
  messageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: designTokens.spacing.space8,
  },
  messageAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: designTokens.spacing.space16,
  },
  messageActionLabel: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
    marginLeft: designTokens.spacing.space4,
  },
  actionDisabled: { opacity: 0.45 },
  actionError: { color: designTokens.color.error, fontSize: designTokens.type.caption.fontSize },
});
