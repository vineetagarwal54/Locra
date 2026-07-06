import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OfflineIndicator } from '../components/OfflineIndicator';
import { ReportButton } from '../components/ReportButton';
import { haptics, theme } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useInferenceStore } from '../store/inferenceStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Answer'>;
type InferenceStatus = ReturnType<typeof useInferenceStore.getState>['status'];

const THUMB_SIZE = 84;
const ANSWER_LINE_HEIGHT_RATIO = 1.6;
const CURSOR_WIDTH = 2;
const CURSOR_HEIGHT = 16;
const CURSOR_BLINK_MS = 1000;
const THUMB_BLURHASH = 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4';

export function AnswerScreen({ navigation, route }: Props) {
  const { imagePath, question } = route.params;

  const status = useInferenceStore((s) => s.status);
  const response = useInferenceStore((s) => s.response);
  const metrics = useInferenceStore((s) => s.metrics);
  const error = useInferenceStore((s) => s.error);
  const limitWarning = useInferenceStore((s) => s.limitWarning);
  const submit = useInferenceStore((s) => s.submit);
  const cancel = useInferenceStore((s) => s.cancel);
  const flagCurrentSession = useInferenceStore((s) => s.flagCurrentSession);

  const [flagged, setFlagged] = useState(false);
  const [turns, setTurns] = useState([{ question, answer: '' }]);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [composerVisible, setComposerVisible] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const activeTurnIndexRef = useRef(0);

  const isGenerating =
    status === 'streaming' || status === 'preprocessing' || status === 'loading_model';
  const isCompleted = status === 'completed';
  const isErrored = status === 'errored';
  const flagDisabled = !isCompleted || flagged;
  const trimmedFollowUpQuestion = followUpQuestion.trim();
  const followUpDisabled = isGenerating || trimmedFollowUpQuestion === '';

  useEffect(() => {
    if (isCompleted) {
      void haptics.success();
      setComposerVisible(true);
    } else if (isErrored) {
      void haptics.error();
    }
  }, [isCompleted, isErrored]);

  useEffect(() => {
    activeTurnIndexRef.current = 0;
    setTurns([{ question, answer: '' }]);
    setFollowUpQuestion('');
    setComposerVisible(false);
    setFlagged(false);
  }, [imagePath, question]);

  useEffect(() => {
    setTurns((currentTurns) => {
      const activeTurnIndex = activeTurnIndexRef.current;
      if (currentTurns.length === 0) {
        return [{ question, answer: response }];
      }
      if (activeTurnIndex >= currentTurns.length) {
        return currentTurns;
      }
      const nextTurns = [...currentTurns];
      nextTurns[activeTurnIndex] = { ...nextTurns[activeTurnIndex], answer: response };
      return nextTurns;
    });
  }, [question, response]);

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

  const scrollToEnd = (): void => {
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  const onBack = (): void => {
    void haptics.tap();
    navigation.goBack();
  };

  const onCancel = (): void => {
    cancel();
    void haptics.tap();
  };

  const onFlag = (): void => {
    if (flagDisabled) {
      return;
    }
    flagCurrentSession();
    void haptics.tap();
    setFlagged(true);
  };

  const onSubmitFollowUp = (): void => {
    if (followUpDisabled) {
      return;
    }

    const nextQuestion = trimmedFollowUpQuestion;
    const previousActiveTurnIndex = Math.max(0, turns.length - 1);
    activeTurnIndexRef.current = turns.length;
    setTurns((currentTurns) => [...currentTurns, { question: nextQuestion, answer: '' }]);
    setFollowUpQuestion('');
    void haptics.tap();
    void submit({ imagePath, question: nextQuestion }).catch(() => {
      activeTurnIndexRef.current = previousActiveTurnIndex;
      setTurns((currentTurns) => currentTurns.slice(0, -1));
      setFollowUpQuestion(nextQuestion);
      void haptics.error();
    });
  };

  const metricPills = metrics
    ? [
        {
          key: 'modelLoad',
          label: 'Model load',
          value: `${Math.round(metrics.modelLoadTimeMs)} ms`,
        },
        {
          key: 'preprocess',
          label: 'Preprocess',
          value: `${Math.round(metrics.preprocessingTimeMs)} ms`,
        },
        {
          key: 'firstToken',
          label: 'First token',
          value: `${Math.round(metrics.firstTokenLatencyMs)} ms`,
        },
        { key: 'tokensPerSec', label: 'Tokens/sec', value: metrics.tokensPerSecond.toFixed(1) },
        { key: 'total', label: 'Total', value: `${Math.round(metrics.totalWallTimeMs)} ms` },
      ]
    : [];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to camera"
          style={styles.backButton}
          onPress={onBack}
        >
          <Text style={styles.backLabel}>Camera</Text>
        </Pressable>
        <Text style={styles.title}>{isGenerating ? 'Looking' : 'Answer'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.offlineRow}>
        <OfflineIndicator />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, (composerVisible || isGenerating) && styles.contentWithDock]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToEnd}
      >
        <View style={styles.promptCard}>
          <Image
            style={styles.thumb}
            source={{ uri: toPreviewUri(imagePath) }}
            placeholder={{ blurhash: THUMB_BLURHASH }}
            transition={theme.animationTiming}
            contentFit="cover"
          />
          <View style={styles.questionBody}>
            <Text style={styles.sectionLabel}>Question</Text>
            <Text style={styles.question}>{question}</Text>
          </View>
        </View>

        <View style={styles.threadBlock}>
          {turns.map((turn, index) => {
            const isLatestTurn = index === turns.length - 1;
            const hasTurnAnswer = turn.answer.trim() !== '';
            return (
              <View key={`${index}-${turn.question}`} style={styles.turnBlock}>
                {index > 0 ? (
                  <View style={styles.followUpQuestionBlock}>
                    <Text style={styles.sectionLabel}>Follow-up</Text>
                    <Text style={styles.question}>{turn.question}</Text>
                  </View>
                ) : null}
                <Text style={styles.sectionLabel}>
                  {isLatestTurn ? getStatusLabel(status) : 'Answer'}
                </Text>
                <View style={styles.answerRow}>
                  <Text style={[styles.answerText, !hasTurnAnswer && styles.answerPlaceholder]}>
                    {hasTurnAnswer
                      ? turn.answer
                      : isLatestTurn
                        ? getAnswerPlaceholder(status)
                        : 'No answer saved.'}
                  </Text>
                  {isLatestTurn && isGenerating ? (
                    <Animated.View style={[styles.cursor, cursorStyle]} />
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        {isErrored && error !== null ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>No answer this time</Text>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        {isCompleted && limitWarning !== null ? (
          <View style={styles.limitWarningCard}>
            <Text style={styles.limitWarningText}>{limitWarning}</Text>
          </View>
        ) : null}

        {isCompleted ? (
          <View style={styles.metricsBlock}>
            <Text style={styles.metricsTitle}>Performance</Text>
            <View style={styles.metricsRow}>
              {metricPills.map((pill) => (
                <View key={pill.key} style={styles.pill}>
                  <Text style={styles.pillValue}>{pill.value}</Text>
                  <Text style={styles.pillLabel}>{pill.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {isCompleted || flagged ? (
          <View style={styles.reportBlock}>
            <ReportButton reported={flagged} disabled={!isCompleted} onReport={onFlag} />
          </View>
        ) : null}

        {flagged ? (
          <Text style={styles.flaggedConfirm}>Saved as flagged on this phone.</Text>
        ) : null}
      </ScrollView>

      {composerVisible || isGenerating ? (
        <KeyboardStickyView offset={{ closed: 0, opened: theme.space2 }} style={styles.bottomDock}>
          {composerVisible ? (
            <View style={styles.followUpComposer}>
              <TextInput
                style={[styles.followUpInput, isGenerating && styles.inputDisabled]}
                value={followUpQuestion}
                onChangeText={setFollowUpQuestion}
                placeholder="Ask a follow-up"
                placeholderTextColor={theme.textSecondary}
                editable={!isGenerating}
                multiline
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Submit follow-up question"
                disabled={followUpDisabled}
                style={({ pressed }) => [
                  styles.followUpButton,
                  pressed && !followUpDisabled && styles.followUpButtonPressed,
                  followUpDisabled && styles.disabled,
                ]}
                onPress={onSubmitFollowUp}
              >
                <Text style={styles.followUpButtonLabel}>{isGenerating ? 'Working' : 'Ask'}</Text>
              </Pressable>
            </View>
          ) : null}

          {isGenerating ? (
            <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          ) : null}
        </KeyboardStickyView>
      ) : null}
    </SafeAreaView>
  );
}

function getStatusLabel(status: InferenceStatus): string {
  if (status === 'preprocessing') return 'Preparing photo';
  if (status === 'loading_model') return 'Loading model';
  if (status === 'streaming') return 'Answering';
  if (status === 'completed') return 'Answer';
  if (status === 'errored') return 'Error';
  if (status === 'cancelled') return 'Cancelled';
  return 'Waiting';
}

function getAnswerPlaceholder(status: InferenceStatus): string {
  if (status === 'preprocessing') return 'Making the photo small enough for this phone.';
  if (status === 'loading_model') return 'Waking up the on-device model.';
  if (status === 'streaming') return 'Looking closely.';
  if (status === 'errored') return 'Locra stopped before it could answer.';
  if (status === 'cancelled') return 'This answer was cancelled.';
  return 'Your answer will appear here.';
}

function toPreviewUri(path: string): string {
  if (path.startsWith('file://') || path.startsWith('content://')) {
    return path;
  }
  return `file://${path}`;
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
  backButton: {
    minWidth: theme.space6 * 3,
    height: theme.space6,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backLabel: {
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
  offlineRow: {
    alignItems: 'center',
    paddingBottom: theme.space3,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: theme.space4,
    paddingBottom: theme.space6,
  },
  contentWithDock: {
    paddingBottom: theme.space6 * 6,
  },
  promptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.space3,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    marginBottom: theme.space5,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: theme.radiusMd,
    marginRight: theme.space3,
    backgroundColor: theme.surface2,
  },
  questionBody: {
    flex: 1,
  },
  sectionLabel: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    fontWeight: '700',
    marginBottom: theme.space1,
  },
  question: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * ANSWER_LINE_HEIGHT_RATIO,
  },
  threadBlock: {
    marginBottom: theme.space5,
  },
  turnBlock: {
    marginBottom: theme.space5,
  },
  followUpQuestionBlock: {
    padding: theme.space3,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    marginBottom: theme.space3,
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
  answerPlaceholder: {
    color: theme.textSecondary,
  },
  cursor: {
    width: CURSOR_WIDTH,
    height: CURSOR_HEIGHT,
    marginLeft: theme.space1,
    marginBottom: theme.space1,
    backgroundColor: theme.accent,
  },
  errorCard: {
    padding: theme.space4,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    marginBottom: theme.space5,
  },
  errorTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
    marginBottom: theme.space2,
  },
  error: {
    color: theme.error,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * ANSWER_LINE_HEIGHT_RATIO,
  },
  limitWarningCard: {
    padding: theme.space3,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginBottom: theme.space5,
  },
  limitWarningText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * ANSWER_LINE_HEIGHT_RATIO,
  },
  followUpComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  followUpInput: {
    flex: 1,
    minHeight: theme.space6 * 2,
    maxHeight: theme.space6 * 5,
    paddingHorizontal: theme.space4,
    paddingVertical: theme.space3,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    lineHeight: theme.fontSizeMd * ANSWER_LINE_HEIGHT_RATIO,
  },
  inputDisabled: {
    color: theme.textSecondary,
  },
  followUpButton: {
    minWidth: theme.space6 * 3,
    height: theme.space6 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
    marginLeft: theme.space3,
    paddingHorizontal: theme.space4,
  },
  followUpButtonPressed: {
    backgroundColor: theme.accentDim,
  },
  followUpButtonLabel: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
  metricsBlock: {
    marginTop: theme.space2,
  },
  metricsTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
    marginBottom: theme.space3,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  pill: {
    minWidth: theme.space6 * 5,
    paddingVertical: theme.space2,
    paddingHorizontal: theme.space3,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginRight: theme.space2,
    marginBottom: theme.space2,
  },
  pillValue: {
    color: theme.accent,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pillLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeXs,
    marginTop: theme.space1,
  },
  reportBlock: {
    marginTop: theme.space4,
  },
  flaggedConfirm: {
    marginTop: theme.space4,
    color: theme.success,
    fontSize: theme.fontSizeSm,
    textAlign: 'center',
  },
  cancelButton: {
    alignSelf: 'center',
    marginTop: theme.space3,
    paddingVertical: theme.space3,
    paddingHorizontal: theme.space6,
    borderRadius: theme.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    backgroundColor: theme.accentGlow,
  },
  cancelLabel: {
    color: theme.accent,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
  },
  bottomDock: {
    paddingHorizontal: theme.space4,
    paddingTop: theme.space3,
    paddingBottom: theme.space3,
    backgroundColor: theme.canvas,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
});
