import { MaterialCommunityIcons } from '@expo/vector-icons';
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
import { useHistoryStore } from '../store/historyStore';
import { useInferenceStore } from '../store/inferenceStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Answer'>;
type InferenceStatus = ReturnType<typeof useInferenceStore.getState>['status'];

interface ThreadTurn {
  question: string;
  answer: string;
}

interface ThreadSeed {
  imagePath: string;
  turns: ThreadTurn[];
  flagged: boolean;
  /** Index of the turn currently being generated, or null when settled. */
  pendingIndex: number | null;
  missing: boolean;
}

const THUMB_SIZE = 56;
const ANSWER_LINE_HEIGHT_RATIO = 1.6;
const CURSOR_WIDTH = 2;
const CURSOR_HEIGHT = 16;
const CURSOR_BLINK_MS = 1000;
const THUMB_BLURHASH = 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4';

/**
 * Seeds the thread from the route: a fresh ask has one unanswered turn already
 * in flight (Capture fired the submit); a history reopen loads the persisted
 * session read-only — `hydrateSession` runs in a mount effect, not here, so no
 * store writes happen during render.
 */
function seedThread(params: Props['route']['params']): ThreadSeed {
  if (params.sessionId !== undefined) {
    const session = useHistoryStore.getState().get(params.sessionId);
    if (session === null) {
      return { imagePath: '', turns: [], flagged: false, pendingIndex: null, missing: true };
    }
    const turns =
      session.turns.length > 0
        ? session.turns
        : [{ question: session.question, answer: session.answer }];
    return {
      imagePath: session.imagePath,
      turns: [...turns],
      flagged: session.flagged,
      pendingIndex: null,
      missing: false,
    };
  }
  return {
    imagePath: params.imagePath,
    turns: [{ question: params.question, answer: '' }],
    flagged: false,
    pendingIndex: 0,
    missing: false,
  };
}

export function AnswerScreen({ navigation, route }: Props) {
  const sessionId = route.params.sessionId;
  const [seed] = useState(() => seedThread(route.params));
  const { imagePath, missing } = seed;

  const status = useInferenceStore((s) => s.status);
  const response = useInferenceStore((s) => s.response);
  const metrics = useInferenceStore((s) => s.metrics);
  const error = useInferenceStore((s) => s.error);
  const limitWarning = useInferenceStore((s) => s.limitWarning);
  const submit = useInferenceStore((s) => s.submit);
  const cancel = useInferenceStore((s) => s.cancel);
  const flagCurrentSession = useInferenceStore((s) => s.flagCurrentSession);

  const [flagged, setFlagged] = useState(seed.flagged);
  const [turns, setTurns] = useState<ThreadTurn[]>(seed.turns);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const scrollRef = useRef<ScrollView | null>(null);
  // Which turn the global streamed response belongs to; null means no turn on
  // this screen is generating, so stale store state can never corrupt the
  // thread (e.g. right after hydrating an old session).
  const pendingIndexRef = useRef<number | null>(seed.pendingIndex);

  // FR-046: reopening from history re-activates the persisted thread so
  // follow-ups continue the same session id.
  useEffect(() => {
    if (sessionId !== undefined) {
      useInferenceStore.getState().hydrateSession(sessionId);
    }
  }, [sessionId]);

  // FR-048: never leave a generation running unobserved after leaving the
  // screen — interrupt any in-flight turn on unmount.
  useEffect(() => {
    return () => {
      const current = useInferenceStore.getState();
      if (
        current.status === 'preprocessing' ||
        current.status === 'loading_model' ||
        current.status === 'streaming'
      ) {
        current.cancel();
      }
    };
  }, []);

  const isGenerating =
    status === 'streaming' || status === 'preprocessing' || status === 'loading_model';
  const hasPendingTurn = pendingIndexRef.current !== null;
  const isErrored = status === 'errored' && hasPendingTurn;
  const canCompose = !missing && !isGenerating;
  const canFlag = turns.some((turn) => turn.answer.trim() !== '') && !flagged && !isGenerating;
  const trimmedFollowUpQuestion = followUpQuestion.trim();
  const followUpDisabled = !canCompose || trimmedFollowUpQuestion === '';

  // Stream the in-flight turn's answer into the thread (guarded by pending).
  useEffect(() => {
    const pendingIndex = pendingIndexRef.current;
    if (pendingIndex === null) {
      return;
    }
    setTurns((currentTurns) => {
      if (pendingIndex >= currentTurns.length) {
        return currentTurns;
      }
      const nextTurns = [...currentTurns];
      nextTurns[pendingIndex] = { ...nextTurns[pendingIndex], answer: response };
      return nextTurns;
    });
  }, [response]);

  // Settle the pending turn when its generation reaches a terminal state.
  useEffect(() => {
    if (pendingIndexRef.current === null) {
      return;
    }
    if (status === 'completed') {
      pendingIndexRef.current = null;
      void haptics.success();
    } else if (status === 'errored') {
      pendingIndexRef.current = null;
      void haptics.error();
    }
  }, [status]);

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
    const pendingIndex = pendingIndexRef.current;
    cancel();
    void haptics.tap();
    if (pendingIndex !== null && pendingIndex > 0) {
      // A stopped follow-up returns its question to the composer for editing,
      // matching FR-007: no partial output is kept.
      const stoppedQuestion = turns[pendingIndex]?.question ?? '';
      pendingIndexRef.current = null;
      setTurns((currentTurns) => currentTurns.slice(0, pendingIndex));
      setFollowUpQuestion((existing) => (existing === '' ? stoppedQuestion : existing));
    } else {
      pendingIndexRef.current = null;
    }
  };

  const onFlag = (): void => {
    if (!canFlag) {
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
    const nextIndex = turns.length;
    pendingIndexRef.current = nextIndex;
    setTurns((currentTurns) => [...currentTurns, { question: nextQuestion, answer: '' }]);
    setFollowUpQuestion('');
    void haptics.tap();
    void submit({ imagePath, question: nextQuestion }).catch(() => {
      pendingIndexRef.current = null;
      setTurns((currentTurns) => currentTurns.slice(0, nextIndex));
      setFollowUpQuestion(nextQuestion);
      void haptics.error();
    });
  };

  const metricPills = metrics
    ? [
        { key: 'modelLoad', label: 'Model load', value: `${Math.round(metrics.modelLoadTimeMs)} ms` },
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

  if (missing) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.missingWrap}>
          <MaterialCommunityIcons
            name="chat-remove-outline"
            size={theme.space6 * 2}
            color={theme.textMuted}
          />
          <Text style={styles.missingTitle}>This chat is gone</Text>
          <Text style={styles.missingBody}>It was deleted from history on this phone.</Text>
          <Pressable accessibilityRole="button" style={styles.missingButton} onPress={onBack}>
            <Text style={styles.missingButtonLabel}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backButton}
          onPress={onBack}
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={theme.textSecondary} />
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
        <Text style={styles.title}>{isGenerating ? 'Looking' : 'Chat'}</Text>
        <View style={styles.headerRight}>
          <OfflineIndicator />
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToEnd}
      >
        <View style={styles.photoCard}>
          <Image
            style={styles.thumb}
            source={{ uri: toPreviewUri(imagePath) }}
            placeholder={{ blurhash: THUMB_BLURHASH }}
            transition={theme.animationTiming}
            contentFit="cover"
          />
          <Text style={styles.photoLabel}>This chat is about this photo</Text>
        </View>

        {turns.map((turn, index) => {
          const isPendingTurn = index === pendingIndexRef.current;
          const hasTurnAnswer = turn.answer.trim() !== '';
          return (
            <View key={`turn-${index}`} style={styles.turnBlock}>
              <View style={styles.userBubble}>
                <Text style={styles.userBubbleText}>{turn.question}</Text>
              </View>
              <View style={styles.answerRow}>
                <Text style={[styles.answerText, !hasTurnAnswer && styles.answerPlaceholder]}>
                  {hasTurnAnswer
                    ? turn.answer
                    : isPendingTurn || isGenerating
                      ? getAnswerPlaceholder(status)
                      : 'No answer saved.'}
                </Text>
                {isPendingTurn && isGenerating ? (
                  <Animated.View style={[styles.cursor, cursorStyle]} />
                ) : null}
              </View>
            </View>
          );
        })}

        {isErrored && error !== null ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>No answer this time</Text>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        {status === 'completed' && limitWarning !== null ? (
          <View style={styles.limitWarningCard}>
            <MaterialCommunityIcons
              name="information-outline"
              size={16}
              color={theme.textSecondary}
            />
            <Text style={styles.limitWarningText}>{limitWarning}</Text>
          </View>
        ) : null}

        {status === 'completed' && metricPills.length > 0 ? (
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

        {canFlag || flagged ? (
          <View style={styles.reportBlock}>
            <ReportButton reported={flagged} disabled={!canFlag && !flagged} onReport={onFlag} />
            {flagged ? (
              <Text style={styles.flaggedConfirm}>Saved as flagged on this phone.</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: theme.space2 }} style={styles.bottomDock}>
        <View style={styles.composer}>
          <TextInput
            style={[styles.composerInput, !canCompose && styles.inputDisabled]}
            value={followUpQuestion}
            onChangeText={setFollowUpQuestion}
            placeholder={isGenerating ? 'Locra is answering…' : 'Ask a follow-up'}
            placeholderTextColor={theme.textSecondary}
            editable={canCompose}
            multiline
          />
          {isGenerating ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop generating"
              style={styles.stopButton}
              onPress={onCancel}
            >
              <MaterialCommunityIcons name="stop" size={22} color={theme.textPrimary} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send follow-up question"
              disabled={followUpDisabled}
              style={({ pressed }) => [
                styles.sendButton,
                pressed && !followUpDisabled && styles.sendButtonPressed,
                followUpDisabled && styles.disabled,
              ]}
              onPress={onSubmitFollowUp}
            >
              <MaterialCommunityIcons name="arrow-up" size={22} color={theme.textPrimary} />
            </Pressable>
          )}
        </View>
      </KeyboardStickyView>
    </SafeAreaView>
  );
}

function getAnswerPlaceholder(status: InferenceStatus): string {
  if (status === 'preprocessing') return 'Making the photo small enough for this phone.';
  if (status === 'loading_model') return 'Waking up the on-device model.';
  if (status === 'streaming') return 'Looking closely.';
  if (status === 'errored') return 'Locra stopped before it could answer.';
  if (status === 'cancelled') return 'This answer was stopped.';
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
    paddingHorizontal: theme.space3,
    paddingVertical: theme.space3,
  },
  backButton: {
    minWidth: theme.space6 * 3,
    height: theme.space6,
    flexDirection: 'row',
    alignItems: 'center',
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
  headerRight: {
    minWidth: theme.space6 * 3,
    alignItems: 'flex-end',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: theme.space4,
    paddingBottom: theme.space6 * 2,
  },
  photoCard: {
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
  photoLabel: {
    flex: 1,
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
  },
  turnBlock: {
    marginBottom: theme.space5,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    paddingHorizontal: theme.space4,
    paddingVertical: theme.space3,
    borderRadius: theme.radiusLg,
    borderBottomRightRadius: theme.radiusSm,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginBottom: theme.space3,
  },
  userBubbleText: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    lineHeight: theme.fontSizeMd * ANSWER_LINE_HEIGHT_RATIO,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space2,
    padding: theme.space3,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginBottom: theme.space5,
  },
  limitWarningText: {
    flex: 1,
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * ANSWER_LINE_HEIGHT_RATIO,
  },
  metricsBlock: {
    marginTop: theme.space2,
    marginBottom: theme.space4,
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
    marginTop: theme.space2,
  },
  flaggedConfirm: {
    marginTop: theme.space3,
    color: theme.success,
    fontSize: theme.fontSizeSm,
    textAlign: 'center',
  },
  bottomDock: {
    paddingHorizontal: theme.space4,
    paddingTop: theme.space3,
    paddingBottom: theme.space3,
    backgroundColor: theme.canvas,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  composerInput: {
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
  sendButton: {
    width: theme.space6 * 2,
    height: theme.space6 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
    marginLeft: theme.space3,
  },
  sendButtonPressed: {
    backgroundColor: theme.accentDim,
  },
  stopButton: {
    width: theme.space6 * 2,
    height: theme.space6 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.surface3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    marginLeft: theme.space3,
  },
  disabled: {
    opacity: 0.45,
  },
  missingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space5,
  },
  missingTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
    marginTop: theme.space4,
    marginBottom: theme.space2,
  },
  missingBody: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
    textAlign: 'center',
    marginBottom: theme.space5,
  },
  missingButton: {
    paddingVertical: theme.space3,
    paddingHorizontal: theme.space6,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
  },
  missingButtonLabel: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
  },
});
