import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptics, theme } from '../constants/theme';
import {
  deriveConversationPreview,
  deriveConversationTitle,
} from '../history/ConversationSearch';
import type { Conversation } from '../types/models';

const READABLE_LINE_HEIGHT_RATIO = 1.4;

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
          color={selected ? theme.textPrimary : theme.accent}
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
    paddingVertical: theme.space3,
    paddingHorizontal: theme.space3,
    borderRadius: theme.radiusMd,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    marginBottom: theme.space2,
  },
  rowPressed: {
    backgroundColor: theme.surface3,
  },
  rowSelected: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  iconWrap: {
    width: theme.space6 + theme.space2,
    height: theme.space6 + theme.space2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginRight: theme.space3,
  },
  iconWrapSelected: {
    backgroundColor: theme.accentDim,
    borderColor: theme.accentDim,
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
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
    marginRight: theme.space2,
  },
  titleSelected: {
    color: theme.textPrimary,
  },
  time: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    fontWeight: '600',
  },
  timeSelected: {
    color: theme.textPrimary,
  },
  preview: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
    marginTop: theme.space1,
  },
  previewSelected: {
    color: theme.textPrimary,
  },
});
