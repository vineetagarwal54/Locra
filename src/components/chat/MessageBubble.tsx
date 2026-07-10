import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptics, theme } from '../../constants/theme';
import type { ConversationMessage } from '../../types/models';

import { ImagePromptCard } from './ImagePromptCard';
import { StreamingMessage } from './StreamingMessage';

const READABLE_LINE_HEIGHT_RATIO = 1.52;

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
              color={theme.error}
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
          <Text style={styles.assistantText}>{text}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  userWrap: {
    alignItems: 'flex-end',
    marginBottom: theme.space4,
  },
  assistantWrap: {
    alignItems: 'flex-start',
    marginBottom: theme.space4,
  },
  userBubble: {
    maxWidth: '86%',
    paddingHorizontal: theme.space4,
    paddingVertical: theme.space3,
    borderRadius: theme.radiusMd,
    borderBottomRightRadius: theme.radiusSm,
    backgroundColor: theme.accent,
  },
  userText: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
  },
  assistantBubble: {
    maxWidth: '92%',
    paddingHorizontal: theme.space4,
    paddingVertical: theme.space3,
    borderRadius: theme.radiusMd,
    borderBottomLeftRadius: theme.radiusSm,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  assistantText: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
  },
  assistantMuted: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
  },
  failedBubble: {
    borderColor: theme.error,
    backgroundColor: theme.errorGlow,
  },
  failedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.space2,
  },
  failedTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
    marginLeft: theme.space2,
  },
  failedText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: theme.space3,
    paddingVertical: theme.space2,
    paddingHorizontal: theme.space4,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
  },
  retryButtonPressed: {
    backgroundColor: theme.accentDim,
  },
  retryButtonLabel: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
  },
});
