import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationListItem } from '../components/ConversationListItem';
import { haptics, theme } from '../constants/theme';
import {
  type RecencyBucket,
  groupConversationsByRecency,
} from '../history/conversationGroups';
import { searchConversations } from '../history/ConversationSearch';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useHistoryStore } from '../store/historyStore';
import type { Conversation } from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

const READABLE_LINE_HEIGHT_RATIO = 1.45;

// design.md §7.14 — every stored conversation stays reachable, including the
// "Older" bucket (FR-019); nothing older than seven days ever disappears.
const HISTORY_GROUP_LABEL: Record<RecencyBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  previous7: 'Previous 7 Days',
  older: 'Older',
};

interface HistorySection {
  title: string;
  data: Conversation[];
}

export function HistoryScreen({ navigation }: Props) {
  const revision = useHistoryStore((s) => s.conversations);
  const refresh = useHistoryStore((s) => s.refresh);
  const [query, setQuery] = useState('');

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sections = useMemo<HistorySection[]>(() => {
    void revision;
    const conversations = useHistoryStore.getState().listConversations();
    const filtered = searchConversations(conversations, query);
    return groupConversationsByRecency(filtered).map((group) => ({
      title: HISTORY_GROUP_LABEL[group.bucket],
      data: group.conversations,
    }));
  }, [revision, query]);

  const hasAnyConversation = useMemo(
    () => useHistoryStore.getState().listConversations(1).length > 0,
    [revision]
  );

  const onBack = useCallback((): void => {
    void haptics.tap();
    navigation.goBack();
  }, [navigation]);

  const onOpenBenchmarks = useCallback((): void => {
    void haptics.tap();
    navigation.navigate('Benchmark');
  }, [navigation]);

  const onResume = useCallback(
    (conversationId: string): void => {
      navigation.navigate('Chat', { conversationId });
    },
    [navigation]
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.headerButton}
          onPress={onBack}
        >
          <MaterialCommunityIcons name="chevron-left" size={26} color={theme.textSecondary} />
        </Pressable>
        <Text style={styles.title}>History</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open benchmarks"
          style={styles.headerButton}
          onPress={onOpenBenchmarks}
        >
          <MaterialCommunityIcons name="speedometer" size={20} color={theme.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <MaterialCommunityIcons name="magnify" size={18} color={theme.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search conversations"
          placeholderTextColor={theme.textMuted}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query !== '' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={theme.space2}
            onPress={() => {
              setQuery('');
            }}
          >
            <MaterialCommunityIcons name="close-circle" size={18} color={theme.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <SectionList<Conversation, HistorySection>
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ConversationListItem conversation={item} onPress={onResume} />
        )}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={
          sections.length === 0 ? styles.emptyContent : styles.listContent
        }
        ListEmptyComponent={<HistoryEmptyState searching={query !== '' && hasAnyConversation} />}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

function HistoryEmptyState({ searching }: { searching: boolean }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyLens}>
        <MaterialCommunityIcons
          name={searching ? 'magnify' : 'chat-outline'}
          size={28}
          color={theme.accent}
        />
      </View>
      <Text style={styles.emptyTitle}>
        {searching ? 'No matching conversations' : 'No conversations yet'}
      </Text>
      <Text style={styles.emptyBody}>
        {searching
          ? 'Try a different word from a question or answer.'
          : 'Your conversations will appear here, grouped by when you last used them.'}
      </Text>
    </View>
  );
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
    paddingHorizontal: theme.space3,
    paddingVertical: theme.space3,
  },
  headerButton: {
    width: theme.space6 * 2,
    height: theme.space6 * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.space4,
    marginBottom: theme.space3,
    paddingHorizontal: theme.space3,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  searchInput: {
    flex: 1,
    height: theme.space6 * 2,
    marginLeft: theme.space2,
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
  },
  listContent: {
    paddingHorizontal: theme.space4,
    paddingBottom: theme.space6,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.space5,
    paddingBottom: theme.space6,
  },
  sectionHeader: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: theme.space3,
    marginBottom: theme.space2,
  },
  emptyState: {
    alignItems: 'center',
  },
  emptyLens: {
    width: theme.space6 * 3,
    height: theme.space6 * 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginBottom: theme.space4,
  },
  emptyTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: theme.space2,
  },
  emptyBody: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
    textAlign: 'center',
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
  },
});
