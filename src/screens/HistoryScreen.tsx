import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import type { ReactElement } from 'react';
import { useCallback, useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, type ListRenderItem, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { haptics, theme } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useHistoryStore } from '../store/historyStore';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;
type HistorySession = ReturnType<typeof useHistoryStore.getState>['sessions'][number];

const THUMB_SIZE = 64;
const READABLE_LINE_HEIGHT_RATIO = 1.45;

export function HistoryScreen({ navigation }: Props) {
  const sessions = useHistoryStore((s) => s.sessions);
  const refresh = useHistoryStore((s) => s.refresh);
  const deleteSession = useHistoryStore((s) => s.delete);
  const clear = useHistoryStore((s) => s.clear);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onBack = useCallback((): void => {
    void haptics.tap();
    navigation.goBack();
  }, [navigation]);

  const onClear = useCallback((): void => {
    if (sessions.length === 0) {
      return;
    }
    void haptics.tap();
    clear();
  }, [clear, sessions.length]);

  const onOpenBenchmarks = useCallback((): void => {
    void haptics.tap();
    navigation.navigate('Benchmark');
  }, [navigation]);

  const renderItem: ListRenderItem<HistorySession> = useCallback(
    ({ item }): ReactElement => (
      <HistoryItem
        session={item}
        onDelete={(id) => {
          void haptics.tap();
          deleteSession(id);
        }}
      />
    ),
    [deleteSession]
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to camera"
          style={styles.headerButton}
          onPress={onBack}
        >
          <Text style={styles.headerButtonLabel}>Camera</Text>
        </Pressable>
        <Text style={styles.title}>History</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear all history"
          disabled={sessions.length === 0}
          style={({ pressed }) => [
            styles.clearButton,
            pressed && sessions.length > 0 && styles.clearButtonPressed,
            sessions.length === 0 && styles.clearButtonDisabled,
          ]}
          onPress={onClear}
        >
          <Text style={styles.clearButtonLabel}>Clear</Text>
        </Pressable>
      </View>

      <View style={styles.benchmarkRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open benchmarks"
          style={({ pressed }) => [
            styles.benchmarkButton,
            pressed && styles.benchmarkButtonPressed,
          ]}
          onPress={onOpenBenchmarks}
        >
          <Text style={styles.benchmarkButtonLabel}>Benchmarks</Text>
        </Pressable>
      </View>

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={sessions.length === 0 ? styles.emptyContent : styles.listContent}
        ListEmptyComponent={<HistoryEmptyState />}
      />
    </SafeAreaView>
  );
}

interface HistoryItemProps {
  session: HistorySession;
  onDelete: (id: string) => void;
}

function HistoryItem({ session, onDelete }: HistoryItemProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Image
          style={styles.thumb}
          source={{ uri: toPreviewUri(session.imagePath) }}
          contentFit="cover"
        />
        <View style={styles.cardTitleBlock}>
          <Text style={styles.timestamp}>{formatTimestamp(session.createdAt)}</Text>
          <Text style={styles.question} numberOfLines={2}>
            {session.question}
          </Text>
        </View>
      </View>

      <Text style={styles.answer} numberOfLines={4}>
        {session.answer}
      </Text>

      {session.metrics !== null ? (
        <View style={styles.metricsGrid}>
          <MetricPill label="Model" value={`${Math.round(session.metrics.modelLoadTimeMs)} ms`} />
          <MetricPill
            label="Image"
            value={`${Math.round(session.metrics.preprocessingTimeMs)} ms`}
          />
          <MetricPill
            label="First"
            value={`${Math.round(session.metrics.firstTokenLatencyMs)} ms`}
          />
          <MetricPill label="Tok/sec" value={session.metrics.tokensPerSecond.toFixed(1)} />
          <MetricPill label="Total" value={`${Math.round(session.metrics.totalWallTimeMs)} ms`} />
        </View>
      ) : null}

      <View style={styles.cardFooter}>
        {session.flagged ? <Text style={styles.flaggedLabel}>Flagged</Text> : <View />}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete history entry for ${session.question}`}
          style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
          onPress={() => onDelete(session.id)}
        >
          <Text style={styles.deleteButtonLabel}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface MetricPillProps {
  label: string;
  value: string;
}

function MetricPill({ label, value }: MetricPillProps) {
  return (
    <View style={styles.metricPill}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function HistoryEmptyState() {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyLens} />
      <Text style={styles.emptyTitle}>No saved questions yet</Text>
      <Text style={styles.emptyBody}>
        Completed answers will appear here with their photo, question, answer, and timing metrics.
      </Text>
    </View>
  );
}

function toPreviewUri(path: string): string {
  if (path.startsWith('file://') || path.startsWith('content://')) {
    return path;
  }
  return `file://${path}`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
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
    paddingVertical: theme.space3,
  },
  headerButton: {
    minWidth: theme.space6 * 3,
    height: theme.space6,
    justifyContent: 'center',
  },
  headerButtonLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
  },
  clearButton: {
    minWidth: theme.space6 * 3,
    height: theme.space6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space3,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
  },
  clearButtonPressed: {
    backgroundColor: theme.surface3,
  },
  clearButtonDisabled: {
    opacity: 0.45,
  },
  clearButtonLabel: {
    color: theme.accent,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
  },
  benchmarkRow: {
    paddingHorizontal: theme.space4,
    paddingBottom: theme.space3,
  },
  benchmarkButton: {
    minHeight: theme.space6 * 2,
    justifyContent: 'center',
    paddingHorizontal: theme.space4,
    paddingVertical: theme.space2,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  benchmarkButtonPressed: {
    backgroundColor: theme.surface3,
  },
  benchmarkButtonLabel: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
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
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radiusLg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: theme.space4,
    marginBottom: theme.space4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.space3,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface2,
    marginRight: theme.space3,
  },
  cardTitleBlock: {
    flex: 1,
  },
  timestamp: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    fontWeight: '700',
    marginBottom: theme.space1,
  },
  question: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
  },
  answer: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
    marginBottom: theme.space4,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: theme.space3,
  },
  metricPill: {
    minWidth: theme.space6 * 4,
    paddingVertical: theme.space2,
    paddingHorizontal: theme.space3,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginRight: theme.space2,
    marginBottom: theme.space2,
  },
  metricValue: {
    color: theme.accent,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeXs,
    marginTop: theme.space1,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  flaggedLabel: {
    color: theme.success,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
  },
  deleteButton: {
    paddingVertical: theme.space2,
    paddingHorizontal: theme.space4,
    borderRadius: theme.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
  },
  deleteButtonPressed: {
    backgroundColor: theme.surface3,
  },
  deleteButtonLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
  },
  emptyLens: {
    width: theme.space6 * 3,
    height: theme.space6 * 3,
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
