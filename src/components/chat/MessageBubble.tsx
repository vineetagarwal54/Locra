import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { designTokens, haptics } from '../../constants/theme';
import type { ConversationMessage } from '../../types/models';

import { ImagePromptCard } from './ImagePromptCard';
import { MarkdownText } from './MarkdownText';
import { StreamingMessage } from './StreamingMessage';

interface MessageBubbleProps {
  message: ConversationMessage;
  streamingText?: string;
  onRetry?: (assistantMessageId: string) => void;
}

export function MessageBubble({ message, streamingText = '', onRetry }: MessageBubbleProps) {
  if (message.role === 'user') {
    return <UserMessage message={message} />;
  }

  return <AssistantMessage message={message} streamingText={streamingText} onRetry={onRetry} />;
}

function UserMessage({ message }: { message: ConversationMessage }) {
  const imagePath = message.attachments.find((attachment) => attachment.kind === 'image')?.path;
  if (imagePath !== undefined) {
    return (
      <View style={styles.userWrap}>
        <ImagePromptCard imagePath={imagePath} question={message.text} />
      </View>
    );
  }

  return (
    <View style={styles.userWrap}>
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{message.text}</Text>
      </View>
    </View>
  );
}

function AssistantMessage({
  message,
  streamingText,
  onRetry,
}: {
  message: ConversationMessage;
  streamingText: string;
  onRetry?: (assistantMessageId: string) => void;
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
        </View>
      </View>
    );
  }

  if (message.status === 'interrupted') {
    return (
      <View style={styles.assistantWrap}>
        <View style={styles.assistantBubble}>
          <Text style={styles.assistantMuted}>This response was stopped.</Text>
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
      </View>
    </View>
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
});
