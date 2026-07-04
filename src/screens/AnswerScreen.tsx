import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OfflineIndicator } from '../components/OfflineIndicator';
import { haptics, theme } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useInferenceStore } from '../store/inferenceStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Answer'>;

const THUMB_SIZE = 80;
const ANSWER_LINE_HEIGHT_RATIO = 1.6;
const CURSOR_WIDTH = 2;
const CURSOR_HEIGHT = 14;
const CURSOR_BLINK_MS = 1000;
// A neutral placeholder blurhash shown until the thumbnail decodes.
const THUMB_BLURHASH = 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4';

export function AnswerScreen({ navigation, route }: Props) {
  const { imagePath, question } = route.params;

  const status = useInferenceStore((s) => s.status);
  const response = useInferenceStore((s) => s.response);
  const metrics = useInferenceStore((s) => s.metrics);
  const error = useInferenceStore((s) => s.error);
  const cancel = useInferenceStore((s) => s.cancel);
  const flagCurrentSession = useInferenceStore((s) => s.flagCurrentSession);

  const [flagged, setFlagged] = useState(false);

  const isGenerating = status === 'streaming' || status === 'preprocessing' || status === 'loading_model';
  const isCompleted = status === 'completed';
  const isErrored = status === 'errored';

  // Terminal-state haptics (constitution Principle III cues).
  useEffect(() => {
    if (isCompleted) {
      void haptics.success();
    } else if (isErrored) {
      void haptics.error();
    }
  }, [isCompleted, isErrored]);

  // Blinking streaming cursor (opacity 1 → 0 → 1) while a generation is live.
  const cursorOpacity = useSharedValue(1);
  useEffect(() => {
    if (isGenerating) {
      cursorOpacity.value = withRepeat(withTiming(0, { duration: CURSOR_BLINK_MS }), -1, true);
    } else {
      cancelAnimation(cursorOpacity);
      cursorOpacity.value = 1;
    }
  }, [isGenerating, cursorOpacity]);
  const cursorStyle = useAnimatedStyle(() => ({ opacity: cursorOpacity.value }));

  const onCancel = (): void => {
    cancel();
    void haptics.tap();
  };

  const onFlag = (): void => {
    flagCurrentSession();
    void haptics.tap();
    setFlagged(true);
  };

  const metricPills = metrics
    ? [
        { key: 'firstToken', label: 'First token', value: `${Math.round(metrics.firstTokenLatencyMs)} ms` },
        { key: 'tokensPerSec', label: 'Tok/sec', value: metrics.tokensPerSecond.toFixed(1) },
        { key: 'total', label: 'Total', value: `${Math.round(metrics.totalWallTimeMs)} ms` },
        { key: 'preprocess', label: 'Preprocess', value: `${Math.round(metrics.preprocessingTimeMs)} ms` },
      ]
    : [];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" style={styles.headerButton} onPress={navigation.goBack}>
          <Text style={styles.headerGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Answer</Text>
        <Pressable accessibilityRole="button" style={styles.headerButton} onPress={onFlag}>
          <Text style={styles.flagGlyph}>⚑</Text>
        </Pressable>
      </View>

      <View style={styles.offlineRow}>
        <OfflineIndicator />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.promptRow}>
          <Image
            style={styles.thumb}
            source={{ uri: `file://${imagePath}` }}
            placeholder={{ blurhash: THUMB_BLURHASH }}
            transition={theme.animationTiming}
            contentFit="cover"
          />
          <Text style={styles.question}>{question}</Text>
        </View>

        <View style={styles.answerRow}>
          <Text style={styles.answerText}>{response}</Text>
          {isGenerating ? <Animated.View style={[styles.cursor, cursorStyle]} /> : null}
        </View>

        {isErrored && error !== null ? <Text style={styles.error}>{error}</Text> : null}

        {isCompleted ? (
          <View style={styles.metricsRow}>
            {metricPills.map((pill) => (
              <View key={pill.key} style={styles.pill}>
                <Text style={styles.pillValue}>{pill.value}</Text>
                <Text style={styles.pillLabel}>{pill.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {flagged ? <Text style={styles.flaggedConfirm}>Flagged</Text> : null}
      </ScrollView>

      {isGenerating ? (
        <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
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
    paddingHorizontal: theme.space4,
    paddingVertical: theme.space3,
  },
  headerButton: {
    width: theme.space6,
    height: theme.space6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerGlyph: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeXl,
  },
  flagGlyph: {
    color: theme.textMuted,
    fontSize: theme.fontSizeLg,
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '600',
  },
  offlineRow: {
    alignItems: 'center',
    paddingBottom: theme.space3,
  },
  content: {
    paddingHorizontal: theme.space4,
    paddingBottom: theme.space6,
  },
  promptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.space4,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: theme.radiusMd,
    marginRight: theme.space3,
    backgroundColor: theme.surface2,
  },
  question: {
    flex: 1,
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
  },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  answerText: {
    flexShrink: 1,
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    lineHeight: theme.fontSizeMd * ANSWER_LINE_HEIGHT_RATIO,
  },
  cursor: {
    width: CURSOR_WIDTH,
    height: CURSOR_HEIGHT,
    marginLeft: theme.space1,
    marginBottom: theme.space1,
    backgroundColor: theme.accent,
  },
  error: {
    marginTop: theme.space4,
    color: theme.error,
    fontSize: theme.fontSizeMd,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: theme.space5,
  },
  pill: {
    paddingVertical: theme.space2,
    paddingHorizontal: theme.space3,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginRight: theme.space2,
    marginBottom: theme.space2,
  },
  pillValue: {
    color: theme.accent,
    fontSize: theme.fontSizeSm,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  pillLabel: {
    color: theme.accent,
    fontSize: theme.fontSizeXs,
  },
  flaggedConfirm: {
    marginTop: theme.space4,
    color: theme.textMuted,
    fontSize: theme.fontSizeSm,
  },
  cancelButton: {
    alignSelf: 'center',
    marginBottom: theme.space4,
    paddingVertical: theme.space3,
    paddingHorizontal: theme.space6,
    borderRadius: theme.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
  },
  cancelLabel: {
    color: theme.accent,
    fontSize: theme.fontSizeMd,
    fontWeight: '600',
  },
});
