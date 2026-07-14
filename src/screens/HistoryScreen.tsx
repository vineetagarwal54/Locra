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
import { useConfirmSheet } from '../components/useConfirmSheet';
import { designTokens, haptics } from '../constants/theme';
import { isDiagnosticsExportAvailable } from '../diagnostics/DiagnosticsAvailability';
import {
  type RecencyBucket,
  groupConversationsByRecency,
} from '../history/conversationGroups';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useHistoryStore } from '../store/historyStore';
import type { Conversation } from '../types/models';

const diagnosticsExportAvailable = isDiagnosticsExportAvailable({ isDevBuild: __DEV__ });

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

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
  const loadMore = useHistoryStore((s) => s.loadMore);
  const loadNewer = useHistoryStore((s) => s.loadNewer);
  const search = useHistoryStore((s) => s.search);
  const deleteConversation = useHistoryStore((s) => s.delete);
  const [query, setQuery] = useState('');
  const { confirm, dialog } = useConfirmSheet();

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sections = useMemo<HistorySection[]>(() => {
    void revision;
    const conversations = query.trim() === ''
      ? useHistoryStore.getState().listConversations()
      : search(query);
    return groupConversationsByRecency(conversations).map((group) => ({
      title: HISTORY_GROUP_LABEL[group.bucket],
      data: group.conversations,
    }));
  }, [revision, query, search]);

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

  const onOpenDiagnosticsExport = useCallback((): void => {
    void haptics.tap();
    navigation.navigate('DiagnosticsExport');
  }, [navigation]);

  const onResume = useCallback(
    (conversationId: string): void => {
      navigation.navigate('Chat', { conversationId });
    },
    [navigation]
  );

  const onDelete = useCallback((conversationId: string): void => {
    confirm({
      title: 'Delete conversation?',
      message: 'This removes its messages and local images from this phone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => deleteConversation(conversationId),
    });
  }, [confirm, deleteConversation]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.headerButton}
          onPress={onBack}
        >
          <MaterialCommunityIcons
            name="chevron-left"
            size={26}
            color={designTokens.color.textSecondary}
          />
        </Pressable>
        <Text style={styles.title}>History</Text>
        <View style={styles.headerActions}>
          {diagnosticsExportAvailable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export diagnostics"
              style={styles.headerButton}
              onPress={onOpenDiagnosticsExport}
            >
              <MaterialCommunityIcons
                name="bug-outline"
                size={20}
                color={designTokens.color.textSecondary}
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open benchmarks"
            style={styles.headerButton}
            onPress={onOpenBenchmarks}
          >
            <MaterialCommunityIcons
              name="speedometer"
              size={20}
              color={designTokens.color.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      <View style={styles.searchRow}>
        <MaterialCommunityIcons name="magnify" size={18} color={designTokens.color.textSecondary} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search conversations"
          placeholderTextColor={designTokens.color.textSecondary}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query !== '' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={designTokens.spacing.space8}
            onPress={() => {
              setQuery('');
            }}
          >
            <MaterialCommunityIcons
              name="close-circle"
              size={18}
              color={designTokens.color.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      <SectionList<Conversation, HistorySection>
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ConversationListItem conversation={item} onPress={onResume} onDelete={onDelete} />
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
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        onScroll={(event) => {
          if (event.nativeEvent.contentOffset.y <= 0) {
            loadNewer();
          }
        }}
        scrollEventThrottle={100}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      />
      {dialog}
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
          color={designTokens.color.primary}
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
    backgroundColor: designTokens.color.canvas,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designTokens.spacing.space12,
    paddingVertical: designTokens.spacing.space12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    width: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24 * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.sectionTitle.fontSize,
    fontWeight: designTokens.type.sectionTitle.fontWeight,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: designTokens.spacing.space16,
    marginBottom: designTokens.spacing.space12,
    paddingHorizontal: designTokens.spacing.space12,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surfaceStrong,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  searchInput: {
    flex: 1,
    height: designTokens.spacing.space24 * 2,
    marginLeft: designTokens.spacing.space8,
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.body.fontSize,
  },
  listContent: {
    paddingHorizontal: designTokens.spacing.space16,
    paddingBottom: designTokens.spacing.space24,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: designTokens.spacing.space20,
    paddingBottom: designTokens.spacing.space24,
  },
  sectionHeader: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
    fontWeight: designTokens.type.caption.fontWeight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: designTokens.spacing.space12,
    marginBottom: designTokens.spacing.space8,
  },
  emptyState: {
    alignItems: 'center',
  },
  emptyLens: {
    width: designTokens.spacing.space24 * 3,
    height: designTokens.spacing.space24 * 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginBottom: designTokens.spacing.space16,
  },
  emptyTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.sectionTitle.fontSize,
    fontWeight: designTokens.type.sectionTitle.fontWeight,
    textAlign: 'center',
    marginBottom: designTokens.spacing.space8,
  },
  emptyBody: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.body.fontSize,
    textAlign: 'center',
    lineHeight: designTokens.type.body.lineHeight,
  },
});
