import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationListItem } from '../components/ConversationListItem';
import { designTokens, haptics } from '../constants/theme';
import { exportDiagnosticsBundle } from '../diagnostics/DiagnosticsExportService';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  listAllConversationHeadersForDiagnostics,
  useHistoryStore,
} from '../store/historyStore';
import type { Conversation } from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'DiagnosticsExport'>;

type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'exporting' }
  | { kind: 'success'; conversationCount: number; turnCount: number }
  | { kind: 'error'; message: string };

export function DiagnosticsExportScreen({ navigation, route }: Props) {
  const revision = useHistoryStore((s) => s.conversations);
  const refresh = useHistoryStore((s) => s.refresh);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(route.params?.conversationId === undefined ? [] : [route.params.conversationId]),
  );
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' });

  useEffect(() => {
    refresh();
  }, [refresh]);

  const conversations = useMemo<Conversation[]>(() => {
    void revision;
    return listAllConversationHeadersForDiagnostics();
  }, [revision]);

  const allSelected = conversations.length > 0 && selectedIds.size === conversations.length;

  const onBack = useCallback((): void => {
    void haptics.tap();
    navigation.goBack();
  }, [navigation]);

  const onToggleConversation = useCallback((conversationId: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  }, []);

  const onToggleSelectAll = useCallback((): void => {
    void haptics.tap();
    setSelectedIds((current) =>
      current.size === conversations.length
        ? new Set()
        : new Set(conversations.map((conversation) => conversation.id)),
    );
  }, [conversations]);

  const onExport = useCallback((): void => {
    void haptics.tap();
    setStatus({ kind: 'exporting' });
    void exportDiagnosticsBundle(Array.from(selectedIds), {
      ...(route.params?.responseId === undefined
        ? {}
        : { responseId: route.params.responseId }),
    })
      .then((result) => {
        setStatus({
          kind: 'success',
          conversationCount: result.conversationCount,
          turnCount: result.turnCount,
        });
      })
      .catch((error: unknown) => {
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Export failed for an unknown reason.',
        });
      });
  }, [route.params?.responseId, selectedIds]);

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
        <Text style={styles.title}>Export Diagnostics</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={allSelected ? 'Deselect all conversations' : 'Select all conversations'}
          style={styles.headerButton}
          onPress={onToggleSelectAll}
        >
          <Text style={styles.selectAllLabel}>{allSelected ? 'None' : 'All'}</Text>
        </Pressable>
      </View>

      {conversations.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyBody}>
            Have a few test conversations first, then come back here to export what happened.
          </Text>
        </View>
      ) : (
        <FlatList<Conversation>
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ConversationListItem
              conversation={item}
              selected={selectedIds.has(item.id)}
              onPress={onToggleConversation}
            />
          )}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <View style={styles.footer}>
        <Text style={styles.disclosure}>
          The bundle includes the selected conversation text, all response attempts, and app,
          model, download, storage, and resource state. Images and local file paths are excluded.
        </Text>
        {status.kind === 'success' ? (
          <Text style={styles.statusSuccess}>
            Exported {status.conversationCount} conversation
            {status.conversationCount === 1 ? '' : 's'} ({status.turnCount} diagnostic turn
            {status.turnCount === 1 ? '' : 's'}).
          </Text>
        ) : null}
        {status.kind === 'error' ? (
          <Text style={styles.statusError}>{status.message}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Export diagnostics bundle"
          accessibilityState={{ disabled: selectedIds.size === 0 || status.kind === 'exporting' }}
          disabled={selectedIds.size === 0 || status.kind === 'exporting'}
          style={[
            styles.exportButton,
            (selectedIds.size === 0 || status.kind === 'exporting') && styles.exportButtonDisabled,
          ]}
          onPress={onExport}
        >
          <Text style={styles.exportButtonLabel}>
            {status.kind === 'exporting'
              ? 'Exporting…'
              : `Export ${selectedIds.size > 0 ? selectedIds.size : ''} bundle`}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
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
  headerButton: {
    minWidth: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24 * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectAllLabel: {
    color: designTokens.color.primary,
    fontSize: designTokens.type.body.fontSize,
    fontWeight: '700',
  },
  title: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.sectionTitle.fontSize,
    fontWeight: designTokens.type.sectionTitle.fontWeight,
  },
  listContent: {
    paddingHorizontal: designTokens.spacing.space16,
    paddingBottom: designTokens.spacing.space24,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: designTokens.spacing.space20,
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
  footer: {
    paddingHorizontal: designTokens.spacing.space16,
    paddingBottom: designTokens.spacing.space16,
    paddingTop: designTokens.spacing.space8,
  },
  statusSuccess: {
    color: designTokens.color.primary,
    fontSize: designTokens.type.caption.fontSize,
    marginBottom: designTokens.spacing.space8,
  },
  disclosure: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
    marginBottom: designTokens.spacing.space8,
  },
  statusError: {
    color: designTokens.color.error,
    fontSize: designTokens.type.caption.fontSize,
    marginBottom: designTokens.spacing.space8,
  },
  exportButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: designTokens.spacing.space12,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.primary,
  },
  exportButtonDisabled: {
    opacity: 0.5,
  },
  exportButtonLabel: {
    color: designTokens.color.onPrimary,
    fontSize: designTokens.type.body.fontSize,
    fontWeight: '700',
  },
});
