import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type ReactElement, useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { designTokens, haptics } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { BenchmarkFilter } from '../persistence/BenchmarkRepository';
import { benchmarkRepository } from '../store/historyStore';
import type { BenchmarkRunRow } from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'Benchmark'>;

type MetricFormat = 'duration' | 'rate';

interface MetricCard {
  readonly accessor: (run: BenchmarkRunRow) => number;
  readonly title: string;
  readonly help: string;
  readonly format: MetricFormat;
  readonly higherBetter: boolean;
  /** Only shown when the visible runs include image turns. */
  readonly imageOnly?: boolean;
}

const MAX_TREND_POINTS = 8;
const RECENT_RUNS_SHOWN = 6;

const METRIC_CARDS: readonly MetricCard[] = [
  {
    accessor: (run) => run.first_token_latency_ms,
    title: 'Time to first token',
    help: 'How quickly Locra starts replying after you send.',
    format: 'duration',
    higherBetter: false,
  },
  {
    accessor: (run) => run.total_wall_time_ms,
    title: 'Total response time',
    help: 'How long the whole answer took to finish.',
    format: 'duration',
    higherBetter: false,
  },
  {
    accessor: (run) => run.tokens_per_second,
    title: 'Tokens per second',
    help: 'How fast Locra writes the answer once it starts.',
    format: 'rate',
    higherBetter: true,
  },
  {
    accessor: (run) => run.model_load_time_ms,
    title: 'Model loading time',
    help: 'Time to get the model ready to answer.',
    format: 'duration',
    higherBetter: false,
  },
  {
    accessor: (run) => run.preprocessing_time_ms,
    title: 'Image preparation',
    help: 'Time spent preparing an attached photo before answering.',
    format: 'duration',
    higherBetter: false,
    imageOnly: true,
  },
];

const FILTERS: readonly { readonly key: BenchmarkFilter; readonly label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'text', label: 'Text' },
  { key: 'image', label: 'Image' },
];

export function BenchmarkScreen({ navigation }: Props): ReactElement {
  const [filter, setFilter] = useState<BenchmarkFilter>('all');
  const [totalCount, setTotalCount] = useState(0);
  const [runs, setRuns] = useState<BenchmarkRunRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      // The store counts across ALL kinds so the empty state only appears when no
      // successful run of any kind exists; the list itself honors the filter.
      setTotalCount(benchmarkRepository.count('all'));
      setRuns(benchmarkRepository.listRecent(filter, 50));
      return undefined;
    }, [filter]),
  );

  const onBack = useCallback((): void => {
    void haptics.tap();
    navigation.goBack();
  }, [navigation]);

  const onSelectFilter = useCallback((next: BenchmarkFilter): void => {
    void haptics.tap();
    setFilter(next);
  }, []);

  const hasImageRuns = runs.some((run) => run.kind === 'image');
  const visibleCards = METRIC_CARDS.filter((card) => card.imageOnly !== true || hasImageRuns);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to history"
          style={styles.headerButton}
          onPress={onBack}
        >
          <Text style={styles.headerButtonLabel}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Benchmarks</Text>
        <View style={styles.headerSpacer} />
      </View>

      {totalCount === 0 ? (
        <BenchmarkEmptyState />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>
            Real performance on this device, measured on each completed answer.
          </Text>

          <View style={styles.filterRow}>
            {FILTERS.map((option) => (
              <FilterChip
                key={option.key}
                label={option.label}
                selected={filter === option.key}
                onPress={() => onSelectFilter(option.key)}
              />
            ))}
          </View>

          {runs.length === 0 ? (
            <View style={styles.noneForFilter}>
              <Text style={styles.noneForFilterText}>
                No {filter} answers yet. Try another filter.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.summaryBlock}>
                <Text style={styles.summaryValue}>{runs.length}</Text>
                <Text style={styles.summaryLabel}>
                  {runs.length === 1 ? 'answer measured' : 'answers measured'}
                </Text>
              </View>

              {visibleCards.map((card) => (
                <MetricCardView key={card.title} card={card} runs={runs} />
              ))}

              <Text style={styles.sectionHeading}>Recent runs</Text>
              {runs.slice(0, RECENT_RUNS_SHOWN).map((run) => (
                <RecentRunRow key={run.id} run={run} />
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${label} runs`}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.chipPressed,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

function MetricCardView({ card, runs }: { card: MetricCard; runs: BenchmarkRunRow[] }): ReactElement {
  // Runs arrive newest-first; chart them oldest→latest.
  const chronological = [...runs].reverse();
  const values = chronological.map(card.accessor);
  const trend = values.slice(-MAX_TREND_POINTS);
  const averageValue = average(values);
  const latestValue = values[values.length - 1] ?? 0;
  const maxValue = Math.max(...trend, 1);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardTitle}>{card.title}</Text>
          <Text style={styles.cardHelp}>{card.help}</Text>
        </View>
        <View style={styles.cardNumbers}>
          <Text style={styles.cardValue}>{formatMetric(averageValue, card.format)}</Text>
          <Text style={styles.cardValueLabel}>average</Text>
        </View>
      </View>

      <View style={styles.trendRow}>
        {trend.map((value, index) => (
          <View key={index} style={styles.trendPoint}>
            <View style={[styles.trendBar, barLevelStyle(value, maxValue, card.higherBetter)]} />
          </View>
        ))}
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.footerText}>{card.higherBetter ? 'higher is better' : 'lower is better'}</Text>
        <Text style={styles.footerText}>latest {formatMetric(latestValue, card.format)}</Text>
      </View>
    </View>
  );
}

function RecentRunRow({ run }: { run: BenchmarkRunRow }): ReactElement {
  return (
    <View style={styles.runRow}>
      <View style={[styles.kindBadge, run.kind === 'image' && styles.kindBadgeImage]}>
        <Text style={[styles.kindBadgeText, run.kind === 'image' && styles.kindBadgeTextImage]}>
          {run.kind === 'image' ? 'Image' : 'Text'}
        </Text>
      </View>
      <View style={styles.runNumbers}>
        <Text style={styles.runPrimary}>
          {formatMetric(run.total_wall_time_ms, 'duration')} total
        </Text>
        <Text style={styles.runSecondary}>
          {formatMetric(run.first_token_latency_ms, 'duration')} to first token ·{' '}
          {formatMetric(run.tokens_per_second, 'rate')}
        </Text>
      </View>
      <Text style={styles.runTime}>{formatRelativeTime(run.created_at)}</Text>
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
        Ask a few questions and Locra will chart time to first token, total response time, tokens
        per second, model loading, and image preparation here.
      </Text>
    </View>
  );
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMetric(value: number, format: MetricFormat): string {
  if (format === 'rate') {
    return `${value.toFixed(1)} tok/s`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  return `${Math.round(value)} ms`;
}

function formatRelativeTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

function barLevelStyle(value: number, maxValue: number, higherBetter: boolean): ViewStyle {
  const ratio = maxValue <= 0 ? 0 : value / maxValue;
  const height = Math.max(designTokens.spacing.space4, Math.round(ratio * (designTokens.spacing.space24 * 2)));
  return { height, opacity: higherBetter ? 0.4 + ratio * 0.6 : 1 - ratio * 0.6 };
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
    paddingHorizontal: designTokens.spacing.space16,
    paddingVertical: designTokens.spacing.space12,
    borderBottomWidth: designTokens.borderWidth,
    borderBottomColor: designTokens.color.divider,
  },
  headerButton: {
    minWidth: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24,
    justifyContent: 'center',
  },
  headerButtonLabel: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.bodyStrong.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
  },
  title: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.sectionTitle.fontSize,
    fontWeight: designTokens.type.sectionTitle.fontWeight,
  },
  headerSpacer: {
    minWidth: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24,
  },
  content: {
    paddingHorizontal: designTokens.spacing.space16,
    paddingBottom: designTokens.spacing.space40,
    paddingTop: designTokens.spacing.space16,
  },
  intro: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
    marginBottom: designTokens.spacing.space16,
  },
  filterRow: {
    flexDirection: 'row',
    gap: designTokens.spacing.space8,
    marginBottom: designTokens.spacing.space16,
  },
  chip: {
    paddingVertical: designTokens.spacing.space8,
    paddingHorizontal: designTokens.spacing.space16,
    borderRadius: designTokens.radius.pill,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    backgroundColor: designTokens.color.surface,
  },
  chipSelected: {
    backgroundColor: designTokens.color.primary,
    borderColor: designTokens.color.primary,
  },
  chipPressed: {
    opacity: 0.85,
  },
  chipLabel: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
  },
  chipLabelSelected: {
    color: designTokens.color.onPrimary,
  },
  noneForFilter: {
    padding: designTokens.spacing.space20,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  noneForFilterText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.body.fontSize,
    textAlign: 'center',
  },
  summaryBlock: {
    marginBottom: designTokens.spacing.space16,
    padding: designTokens.spacing.space16,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  summaryValue: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.screenTitle.fontSize,
    fontWeight: designTokens.type.screenTitle.fontWeight,
  },
  summaryLabel: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    marginTop: designTokens.spacing.space4,
  },
  card: {
    marginBottom: designTokens.spacing.space16,
    padding: designTokens.spacing.space16,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surfaceStrong,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: designTokens.spacing.space16,
  },
  cardTitleBlock: {
    flex: 1,
    paddingRight: designTokens.spacing.space12,
  },
  cardTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.cardTitle.fontSize,
    fontWeight: designTokens.type.cardTitle.fontWeight,
  },
  cardHelp: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    marginTop: designTokens.spacing.space4,
  },
  cardNumbers: {
    alignItems: 'flex-end',
  },
  cardValue: {
    color: designTokens.color.primary,
    fontSize: designTokens.type.cardTitle.fontSize,
    fontWeight: designTokens.type.cardTitle.fontWeight,
  },
  cardValueLabel: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
    marginTop: designTokens.spacing.space4,
  },
  trendRow: {
    height: designTokens.spacing.space24 * 2,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: designTokens.spacing.space4,
  },
  trendPoint: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  trendBar: {
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.primary,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: designTokens.spacing.space12,
  },
  footerText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
  },
  sectionHeading: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.bodyStrong.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    marginTop: designTokens.spacing.space8,
    marginBottom: designTokens.spacing.space12,
  },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: designTokens.spacing.space12,
    paddingHorizontal: designTokens.spacing.space16,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginBottom: designTokens.spacing.space8,
  },
  kindBadge: {
    paddingVertical: designTokens.spacing.space4,
    paddingHorizontal: designTokens.spacing.space8,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.divider,
    marginRight: designTokens.spacing.space12,
  },
  kindBadgeImage: {
    backgroundColor: designTokens.color.primarySoft,
  },
  kindBadgeText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
  },
  kindBadgeTextImage: {
    color: designTokens.color.onPrimary,
  },
  runNumbers: {
    flex: 1,
  },
  runPrimary: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.body.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
  },
  runSecondary: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    marginTop: designTokens.spacing.space4,
  },
  runTime: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
    marginLeft: designTokens.spacing.space8,
  },
  emptyContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: designTokens.spacing.space24,
    paddingBottom: designTokens.spacing.space40,
  },
  emptyMeter: {
    width: designTokens.spacing.space40 * 3,
    height: designTokens.spacing.space24 * 3,
    justifyContent: 'flex-end',
    padding: designTokens.spacing.space8,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginBottom: designTokens.spacing.space16,
  },
  emptyMeterFill: {
    height: designTokens.spacing.space24,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.primarySoft,
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
