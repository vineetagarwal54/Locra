import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationListItem } from '../components/ConversationListItem';
import { designTokens, haptics } from '../constants/theme';
import {
  prepareDiagnosticsExportBundle,
  shareDiagnosticsExportBundle,
} from '../diagnostics/DiagnosticsExportRuntime';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  listAllConversationHeadersForDiagnostics,
  useHistoryStore,
} from '../store/historyStore';
import type { Conversation } from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'DiagnosticsExport'>;

// Explicit two-phase flow: the ZIP is created locally first (preparing →
// creating-zip → ready); the OS share sheet only opens after the user taps Share
// (sharing → shared/cancelled). Nothing is ever uploaded automatically.
type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'creating-zip' }
  | { kind: 'ready'; uri: string; conversationCount: number; turnCount: number }
  | { kind: 'sharing'; uri: string; conversationCount: number; turnCount: number }
  | { kind: 'shared' }
  | { kind: 'cancelled'; uri: string; conversationCount: number; turnCount: number }
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
    // Changing the selection invalidates any already-prepared file.
    setStatus({ kind: 'idle' });
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
    setStatus({ kind: 'idle' });
    setSelectedIds((current) =>
      current.size === conversations.length
        ? new Set()
        : new Set(conversations.map((conversation) => conversation.id)),
    );
  }, [conversations]);

  const onCreate = useCallback((): void => {
    void haptics.tap();
    setStatus({ kind: 'preparing' });
    void prepareDiagnosticsExportBundle(
      Array.from(selectedIds),
      route.params?.responseId === undefined ? {} : { responseId: route.params.responseId },
      (stage) => setStatus({ kind: stage }),
    )
      .then((result) => {
        setStatus({
          kind: 'ready',
          uri: result.uri,
          conversationCount: result.conversationCount,
          turnCount: result.turnCount,
        });
      })
      .catch((error: unknown) => {
        setStatus({
          kind: 'error',
          message:
            error instanceof Error ? error.message : 'Creating the diagnostics file failed.',
        });
      });
  }, [route.params?.responseId, selectedIds]);

  const onShare = useCallback(
    (uri: string, conversationCount: number, turnCount: number): void => {
      void haptics.tap();
      setStatus({ kind: 'sharing', uri, conversationCount, turnCount });
      void shareDiagnosticsExportBundle(uri)
        .then((outcome) => {
          // A dismissed/cancelled share sheet is NOT a failure; the file is kept.
          setStatus(
            outcome === 'shared'
              ? { kind: 'shared' }
              : { kind: 'cancelled', uri, conversationCount, turnCount },
          );
        })
        .catch(() => {
          setStatus({ kind: 'cancelled', uri, conversationCount, turnCount });
        });
    },
    [],
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
          The ZIP is created on your device and is never uploaded. It may include the selected
          conversation text, response attempts, inference timings, context-selection diagnostics,
          app / build / model / database versions, model state, storage state, and recent errors.
          Images, model files, audio, secrets, tokens, absolute file paths, and device identifiers
          are excluded.
        </Text>
        <StatusLine status={status} />
        <ExportActionButton
          status={status}
          selectionCount={selectedIds.size}
          onCreate={onCreate}
          onShare={onShare}
        />
      </View>
    </SafeAreaView>
  );
}

function StatusLine({ status }: { status: ExportStatus }) {
  switch (status.kind) {
    case 'preparing':
      return <Text style={styles.statusInfo}>Preparing diagnostics…</Text>;
    case 'creating-zip':
      return <Text style={styles.statusInfo}>Creating ZIP…</Text>;
    case 'ready':
      return (
        <Text style={styles.statusSuccess}>
          {describeContents(status.conversationCount, status.turnCount)} ready to share.
        </Text>
      );
    case 'sharing':
      return <Text style={styles.statusInfo}>Opening the share sheet…</Text>;
    case 'shared':
      return <Text style={styles.statusSuccess}>Diagnostics shared.</Text>;
    case 'cancelled':
      return (
        <Text style={styles.statusInfo}>Sharing cancelled. The file is kept — share it again anytime.</Text>
      );
    case 'error':
      return <Text style={styles.statusError}>{status.message}</Text>;
    default:
      return null;
  }
}

function ExportActionButton({
  status,
  selectionCount,
  onCreate,
  onShare,
}: {
  status: ExportStatus;
  selectionCount: number;
  onCreate: () => void;
  onShare: (uri: string, conversationCount: number, turnCount: number) => void;
}) {
  const busy =
    status.kind === 'preparing' || status.kind === 'creating-zip' || status.kind === 'sharing';

  if (status.kind === 'ready' || status.kind === 'cancelled') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share diagnostics file"
        style={styles.exportButton}
        onPress={() => onShare(status.uri, status.conversationCount, status.turnCount)}
      >
        <Text style={styles.exportButtonLabel}>Share diagnostics file</Text>
      </Pressable>
    );
  }

  const disabled = busy || selectionCount === 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Create diagnostics file"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[styles.exportButton, disabled && styles.exportButtonDisabled]}
      onPress={onCreate}
    >
      <Text style={styles.exportButtonLabel}>{createButtonLabel(status, selectionCount)}</Text>
    </Pressable>
  );
}

function createButtonLabel(status: ExportStatus, selectionCount: number): string {
  if (status.kind === 'preparing') {
    return 'Preparing…';
  }
  if (status.kind === 'creating-zip') {
    return 'Creating ZIP…';
  }
  if (status.kind === 'sharing') {
    return 'Sharing…';
  }
  return `Create diagnostics file${selectionCount > 0 ? ` (${selectionCount})` : ''}`;
}

function describeContents(conversationCount: number, turnCount: number): string {
  const conversations = `${conversationCount} conversation${conversationCount === 1 ? '' : 's'}`;
  const turns = `${turnCount} diagnostic turn${turnCount === 1 ? '' : 's'}`;
  return `${conversations} (${turns})`;
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
  statusInfo: {
    color: designTokens.color.textSecondary,
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
