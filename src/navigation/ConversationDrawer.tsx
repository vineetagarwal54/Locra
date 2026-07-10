import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  type DrawerContentComponentProps,
  DrawerContentScrollView,
} from '@react-navigation/drawer';
import type { NavigationState, PartialState } from '@react-navigation/native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConversationListItem } from '../components/ConversationListItem';
import { haptics, theme } from '../constants/theme';
import {
  type ConversationRecencyGroup,
  groupConversationsByRecency,
} from '../history/conversationGroups';
import { conversationStore } from '../store/conversationStore';
import { useHistoryStore } from '../store/historyStore';

// Recent conversations shown in the drawer; the full set lives in History (T047).
const DRAWER_LIMIT = 20;

const DRAWER_GROUP_LABEL: Record<ConversationRecencyGroup['bucket'], string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  // The drawer collapses everything older than yesterday into one "Previous"
  // group (design.md §7.10); History keeps the finer Previous 7 Days / Older split.
  previous7: 'Previous',
  older: 'Previous',
};

export function ConversationDrawer(props: DrawerContentComponentProps) {
  const { navigation } = props;
  const revision = useHistoryStore((s) => s.conversations);
  const activeConversationId = findActiveConversationId(props.state);

  const groups = useMemo(() => {
    // revision is a change-tick; the actual list is read imperatively so the
    // selector never returns a fresh array on unrelated renders.
    void revision;
    const recent = useHistoryStore.getState().listConversations(DRAWER_LIMIT);
    return collapseDrawerGroups(groupConversationsByRecency(recent));
  }, [revision]);

  // The drawer is the root navigator; Chat/History live in the nested 'Root'
  // stack. Navigation actions only bubble upward, so drawer content must target
  // the nested screen explicitly via the 'Root' route.
  const navigateToChat = (conversationId: string): void => {
    navigation.closeDrawer();
    navigation.navigate('Root', {
      screen: 'Chat',
      params: { conversationId },
    });
  };

  const onNewChat = (): void => {
    void haptics.tap();
    conversationStore.startNewConversation();
    navigateToChat('new');
  };

  const onResume = (conversationId: string): void => {
    navigateToChat(conversationId);
  };

  const onViewAllHistory = (): void => {
    void haptics.tap();
    navigation.closeDrawer();
    navigation.navigate('Root', { screen: 'History' });
  };

  const onSettings = (): void => {
    void haptics.tap();
    navigation.closeDrawer();
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.brand}>Locra</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close conversations"
          style={styles.headerButton}
          onPress={() => {
            navigation.closeDrawer();
          }}
        >
          <MaterialCommunityIcons name="close" size={22} color={theme.textSecondary} />
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start a new conversation"
        style={({ pressed }) => [styles.newChat, pressed && styles.newChatPressed]}
        onPress={onNewChat}
      >
        <MaterialCommunityIcons name="plus" size={20} color={theme.textPrimary} />
        <Text style={styles.newChatLabel}>New chat</Text>
      </Pressable>

      <DrawerContentScrollView
        {...props}
        contentContainerStyle={styles.scrollContent}
      >
        {groups.length === 0 ? (
          <Text style={styles.emptyText}>No conversations yet.</Text>
        ) : (
          groups.map((group) => (
            <View key={group.label} style={styles.group}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              {group.conversations.map((conversation) => (
                <ConversationListItem
                  key={conversation.id}
                  conversation={conversation}
                  selected={conversation.id === activeConversationId}
                  onPress={onResume}
                />
              ))}
            </View>
          ))
        )}
      </DrawerContentScrollView>

      <View style={styles.footer}>
        <FooterButton icon="history" label="View all history" onPress={onViewAllHistory} />
        <FooterButton icon="cog-outline" label="Settings" onPress={onSettings} />
      </View>
    </View>
  );
}

interface FooterButtonProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
}

function FooterButton({ icon, label, onPress }: FooterButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.footerButton, pressed && styles.footerButtonPressed]}
      onPress={onPress}
    >
      <MaterialCommunityIcons name={icon} size={20} color={theme.textSecondary} />
      <Text style={styles.footerButtonLabel}>{label}</Text>
    </Pressable>
  );
}

interface DrawerGroup {
  label: string;
  conversations: ConversationRecencyGroup['conversations'];
}

// Merge adjacent recency groups that share a drawer label (previous7 + older →
// "Previous"), preserving order.
function collapseDrawerGroups(groups: ConversationRecencyGroup[]): DrawerGroup[] {
  const result: DrawerGroup[] = [];
  for (const group of groups) {
    const label = DRAWER_GROUP_LABEL[group.bucket];
    const last = result.at(-1);
    if (last !== undefined && last.label === label) {
      last.conversations = [...last.conversations, ...group.conversations];
    } else {
      result.push({ label, conversations: [...group.conversations] });
    }
  }
  return result;
}

type AnyNavState = NavigationState | PartialState<NavigationState> | undefined;

// Walk the nested navigation tree to find the focused Chat route so the drawer
// can highlight the conversation currently on screen (design.md §7.10: the active
// conversation uses a filled green row).
function findActiveConversationId(state: AnyNavState): string | null {
  let current: AnyNavState = state;
  while (current !== undefined && current.routes.length > 0) {
    const index = current.index ?? current.routes.length - 1;
    const route = current.routes[index];
    if (route === undefined) {
      return null;
    }
    if (route.name === 'Chat') {
      const params = route.params as { conversationId?: string } | undefined;
      return params?.conversationId ?? null;
    }
    current = route.state as AnyNavState;
  }
  return null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.canvas,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space4,
    paddingTop: theme.space6,
    paddingBottom: theme.space3,
  },
  brand: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
  },
  headerButton: {
    width: theme.space6 * 2,
    height: theme.space6 * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.space4,
    marginBottom: theme.space2,
    paddingVertical: theme.space3,
    paddingHorizontal: theme.space4,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
  },
  newChatPressed: {
    backgroundColor: theme.accentDim,
  },
  newChatLabel: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
    marginLeft: theme.space2,
  },
  scrollContent: {
    paddingHorizontal: theme.space4,
    paddingTop: theme.space2,
    paddingBottom: theme.space4,
  },
  group: {
    marginBottom: theme.space4,
  },
  groupLabel: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.space2,
  },
  emptyText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
    paddingVertical: theme.space4,
  },
  footer: {
    paddingHorizontal: theme.space4,
    paddingTop: theme.space3,
    paddingBottom: theme.space5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.space3,
  },
  footerButtonPressed: {
    opacity: 0.6,
  },
  footerButtonLabel: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '600',
    marginLeft: theme.space3,
  },
});
