import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { haptics, theme } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useHistoryStore } from '../store/historyStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Benchmark'>;
type HistorySession = ReturnType<typeof useHistoryStore.getState>['conversations'][number];
type SessionWithMetrics = HistorySession & { metrics: NonNullable<HistorySession['metrics']> };
type PerformanceMetrics = NonNullable<HistorySession['metrics']>;
type MetricKey = keyof PerformanceMetrics;

interface MetricDefinition {
  key: MetricKey;
  title: string;
  unit: string;
  summaryLabel: string;
}

interface MetricTrend {
  definition: MetricDefinition;
  average: number;
  latest: number;
  values: number[];
}

const READABLE_LINE_HEIGHT_RATIO = 1.45;
const MAX_TREND_POINTS = 8;
const METRICS: MetricDefinition[] = [
  {
    key: 'modelLoadTimeMs',
    title: 'Model load',
    unit: 'ms',
    summaryLabel: 'Lower is smoother',
  },
  {
    key: 'preprocessingTimeMs',
    title: 'Image prep',
    unit: 'ms',
    summaryLabel: 'Lower is smoother',
  },
  {
    key: 'firstTokenLatencyMs',
    title: 'First token',
    unit: 'ms',
    summaryLabel: 'Lower is smoother',
  },
  {
    key: 'tokensPerSecond',
    title: 'Tokens/sec',
    unit: '',
    summaryLabel: 'Higher is faster',
  },
  {
    key: 'totalWallTimeMs',
    title: 'Total time',
    unit: 'ms',
    summaryLabel: 'Lower is smoother',
  },
];

export function BenchmarkScreen({ navigation }: Props): ReactElement {
  const sessions = useHistoryStore((s) => s.conversations);
  const refresh = useHistoryStore((s) => s.refresh);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const completedSessions = useMemo(() => sessions.filter(hasMetrics), [sessions]);
  const trends = useMemo(() => buildMetricTrends(completedSessions), [completedSessions]);

  const onBack = useCallback((): void => {
    void haptics.tap();
    navigation.goBack();
  }, [navigation]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to history"
          style={styles.headerButton}
          onPress={onBack}
        >
          <Text style={styles.headerButtonLabel}>History</Text>
        </Pressable>
        <Text style={styles.title}>Benchmarks</Text>
        <View style={styles.headerSpacer} />
      </View>

      {completedSessions.length === 0 ? (
        <BenchmarkEmptyState />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summaryBlock}>
            <Text style={styles.summaryValue}>{completedSessions.length}</Text>
            <Text style={styles.summaryLabel}>
              {completedSessions.length === 1 ? 'answer tracked' : 'answers tracked'}
            </Text>
          </View>

          {trends.map((trend) => (
            <MetricTrendCard key={trend.definition.key} trend={trend} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

interface MetricTrendCardProps {
  trend: MetricTrend;
}

function MetricTrendCard({ trend }: MetricTrendCardProps): ReactElement {
  const maxValue = Math.max(...trend.values, 1);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardTitle}>{trend.definition.title}</Text>
          <Text style={styles.cardSubtitle}>{trend.definition.summaryLabel}</Text>
        </View>
        <View style={styles.metricNumbers}>
          <Text style={styles.metricValue}>{formatMetric(trend.average, trend.definition)}</Text>
          <Text style={styles.metricLabel}>avg</Text>
        </View>
      </View>

      <View style={styles.trendRow}>
        {trend.values.map((value, index) => (
          <View
            key={`${trend.definition.key}-${index}`}
            style={styles.trendPoint}
            accessibilityLabel={`${trend.definition.title} sample ${index + 1}: ${formatMetric(
              value,
              trend.definition
            )}`}
          >
            <View style={[styles.trendBar, getBarLevelStyle(value, maxValue)]} />
          </View>
        ))}
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.footerText}>oldest</Text>
        <Text style={styles.footerText}>
          latest {formatMetric(trend.latest, trend.definition)}
        </Text>
      </View>
    </View>
  );
}

function BenchmarkEmptyState(): ReactElement {
  return (
    <View style={styles.emptyContent}>
      <View style={styles.emptyMeter}>
        <View style={styles.emptyMeterFill} />
      </View>
      <Text style={styles.emptyTitle}>No timing history yet</Text>
      <Text style={styles.emptyBody}>
        Ask a few questions and Locra will chart model load, image prep, first token, tokens per
        second, and total time here.
      </Text>
    </View>
  );
}

function hasMetrics(session: HistorySession): session is SessionWithMetrics {
  return session.metrics !== null;
}

function buildMetricTrends(sessions: SessionWithMetrics[]): MetricTrend[] {
  return METRICS.map((definition) => {
    const chronologicalValues = sessions
      .slice(0, MAX_TREND_POINTS)
      .reverse()
      .map((session) => session.metrics[definition.key]);
    const allValues = sessions.map((session) => session.metrics[definition.key]);

    return {
      definition,
      average: average(allValues),
      latest: chronologicalValues[chronologicalValues.length - 1] ?? 0,
      values: chronologicalValues,
    };
  });
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMetric(value: number, definition: MetricDefinition): string {
  if (definition.key === 'tokensPerSecond') {
    return value.toFixed(1);
  }
  return `${Math.round(value)} ${definition.unit}`;
}

function getBarLevelStyle(value: number, maxValue: number): ViewStyle {
  const ratio = maxValue <= 0 ? 0 : value / maxValue;
  if (ratio >= 0.8) return styles.barLevel5;
  if (ratio >= 0.6) return styles.barLevel4;
  if (ratio >= 0.4) return styles.barLevel3;
  if (ratio >= 0.2) return styles.barLevel2;
  return styles.barLevel1;
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
  headerSpacer: {
    minWidth: theme.space6 * 3,
    height: theme.space6,
  },
  content: {
    paddingHorizontal: theme.space4,
    paddingBottom: theme.space6,
  },
  summaryBlock: {
    marginBottom: theme.space4,
    padding: theme.space4,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  summaryValue: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeXl,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    marginTop: theme.space1,
  },
  card: {
    marginBottom: theme.space4,
    padding: theme.space4,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: theme.space4,
  },
  cardTitleBlock: {
    flex: 1,
    paddingRight: theme.space3,
  },
  cardTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    marginTop: theme.space1,
  },
  metricNumbers: {
    alignItems: 'flex-end',
  },
  metricValue: {
    color: theme.accent,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    marginTop: theme.space1,
  },
  trendRow: {
    height: theme.space6 * 3,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  trendPoint: {
    flex: 1,
    height: theme.space6 * 3,
    justifyContent: 'flex-end',
    marginRight: theme.space1,
  },
  trendBar: {
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
  },
  barLevel1: {
    height: theme.space2,
    opacity: 0.35,
  },
  barLevel2: {
    height: theme.space4,
    opacity: 0.5,
  },
  barLevel3: {
    height: theme.space6,
    opacity: 0.65,
  },
  barLevel4: {
    height: theme.space6 * 2,
    opacity: 0.8,
  },
  barLevel5: {
    height: theme.space6 * 3,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.space3,
  },
  footerText: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    fontVariant: ['tabular-nums'],
  },
  emptyContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space5,
    paddingBottom: theme.space6,
  },
  emptyMeter: {
    width: theme.space6 * 5,
    height: theme.space6 * 3,
    justifyContent: 'flex-end',
    padding: theme.space2,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    marginBottom: theme.space4,
  },
  emptyMeterFill: {
    height: theme.space6,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
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
