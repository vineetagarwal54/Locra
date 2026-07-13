import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { designTokens, haptics } from '../constants/theme';
import {
  deriveConversationPreview,
  deriveConversationTitle,
} from '../history/ConversationSearch';
import type { Conversation } from '../types/models';

interface ConversationListItemProps {
  conversation: Conversation;
  selected?: boolean;
  onPress: (conversationId: string) => void;
}

// Shared row for the Conversation Drawer (T045) and Full History (T047).
// design.md §8 "Cards and rows" / §9 "Conversation row": default / pressed /
// selected only — deliberately no unread badges.
export function ConversationListItem({
  conversation,
  selected = false,
  onPress,
}: ConversationListItemProps) {
  const title = deriveConversationTitle(conversation);
  const preview = deriveConversationPreview(conversation);
  const hasImage = conversation.messages.some((message) => message.attachments.length > 0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Resume conversation: ${title}`}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && !selected && styles.rowPressed,
      ]}
      onPress={() => {
        void haptics.tap();
        onPress(conversation.id);
      }}
    >
      <View style={[styles.iconWrap, selected && styles.iconWrapSelected]}>
        <MaterialCommunityIcons
          name={hasImage ? 'image-outline' : 'chat-outline'}
          size={18}
          color={selected ? designTokens.color.onPrimary : designTokens.color.primary}
        />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, selected && styles.titleSelected]}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text style={[styles.time, selected && styles.timeSelected]}>
            {formatTime(conversation.updatedAt)}
          </Text>
        </View>
        <Text
          style={[styles.preview, selected && styles.previewSelected]}
          numberOfLines={1}
        >
          {preview}
        </Text>
      </View>
    </Pressable>
  );
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: designTokens.spacing.space12,
    paddingHorizontal: designTokens.spacing.space12,
    borderRadius: designTokens.radius.card,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    backgroundColor: designTokens.color.surfaceStrong,
    marginBottom: designTokens.spacing.space8,
  },
  rowPressed: {
    backgroundColor: designTokens.color.surface,
  },
  rowSelected: {
    backgroundColor: designTokens.color.primary,
    borderColor: designTokens.color.primary,
  },
  iconWrap: {
    width: designTokens.spacing.space24 + designTokens.spacing.space8,
    height: designTokens.spacing.space24 + designTokens.spacing.space8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginRight: designTokens.spacing.space12,
  },
  iconWrapSelected: {
    backgroundColor: designTokens.color.primarySoft,
    borderColor: designTokens.color.primarySoft,
  },
  body: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.bodyStrong.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    marginRight: designTokens.spacing.space8,
  },
  titleSelected: {
    color: designTokens.color.onPrimary,
  },
  time: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
    fontWeight: designTokens.type.caption.fontWeight,
  },
  timeSelected: {
    color: designTokens.color.onPrimary,
  },
  preview: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
    marginTop: designTokens.spacing.space4,
  },
  previewSelected: {
    color: designTokens.color.onPrimary,
  },
});
