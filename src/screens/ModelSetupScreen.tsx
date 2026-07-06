import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { haptics, theme } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { requestDownloadNotificationPermission } from '../platform/NotificationPermission';
import { useModelStore } from '../store/modelStore';

type Props = NativeStackScreenProps<RootStackParamList, 'ModelSetup'>;
type ModelDownloadStatus = ReturnType<typeof useModelStore.getState>['downloadStatus'];
type PrimaryDownloadAction = 'start' | 'pause' | 'resume';
type StepState = 'pending' | 'active' | 'paused' | 'done';

interface PrimaryActionConfig {
  action: PrimaryDownloadAction;
  label: string;
  accessibilityLabel: string;
  variant: 'primary' | 'secondary';
}

interface SetupStep {
  key: string;
  title: string;
  detail: string;
  state: StepState;
}

const READABLE_LINE_HEIGHT_RATIO = 1.5;
const PROGRESS_MIN_PERCENT = 4;
const SHIMMER_WIDTH = 84;
const SHIMMER_TRAVEL = 320;
const SHIMMER_DURATION_MS = 1400;

export function ModelSetupScreen({ navigation }: Props) {
  const [notificationPermissionDenied, setNotificationPermissionDenied] = useState(false);
  const downloadStatus = useModelStore((s) => s.downloadStatus);
  const downloadProgress = useModelStore((s) => s.downloadProgress);
  const integrityVerified = useModelStore((s) => s.integrityVerified);
  const error = useModelStore((s) => s.error);

  const checkDeviceCompatibility = useModelStore((s) => s.checkDeviceCompatibility);
  const startDownload = useModelStore((s) => s.startDownload);
  const pauseDownload = useModelStore((s) => s.pauseDownload);
  const resumeDownload = useModelStore((s) => s.resumeDownload);
  const cancelDownload = useModelStore((s) => s.cancelDownload);

  const compatibility = useMemo(() => checkDeviceCompatibility(), [checkDeviceCompatibility]);
  const isReady = downloadStatus === 'downloaded' && integrityVerified;
  const progress = clampProgress(downloadProgress);
  const progressPercent = Math.round(progress * 100);
  const primaryAction = getPrimaryAction(downloadStatus);
  const canCancel = downloadStatus === 'downloading' || downloadStatus === 'paused';
  const setupSteps = getSetupSteps(downloadStatus, progressPercent, integrityVerified);

  const progressValue = useSharedValue(progress);
  const shimmerValue = useSharedValue(0);

  useEffect(() => {
    progressValue.value = withTiming(progress, { duration: theme.animationTiming });
  }, [progress, progressValue]);

  useEffect(() => {
    if (downloadStatus === 'downloading') {
      shimmerValue.value = 0;
      shimmerValue.value = withRepeat(withTiming(1, { duration: SHIMMER_DURATION_MS }), -1, false);
    } else {
      cancelAnimation(shimmerValue);
      shimmerValue.value = 0;
    }
  }, [downloadStatus, shimmerValue]);

  const progressFillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(PROGRESS_MIN_PERCENT, progressValue.value * 100)}%`,
  }));
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerValue.value * SHIMMER_TRAVEL - SHIMMER_WIDTH }],
  }));

  useEffect(() => {
    if (isReady) {
      navigation.replace('Capture');
    }
  }, [isReady, navigation]);

  const onPrimaryAction = async (): Promise<void> => {
    if (primaryAction === null) {
      return;
    }
    void haptics.tap();
    if (primaryAction.action === 'start') {
      const canShowNotifications = await requestDownloadNotificationPermission();
      setNotificationPermissionDenied(!canShowNotifications);
      void startDownload();
    } else if (primaryAction.action === 'pause') {
      void pauseDownload();
    } else {
      void resumeDownload();
    }
  };

  const onCancel = (): void => {
    void haptics.tap();
    void cancelDownload();
  };

  if (!compatibility.isSupported) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>Setup</Text>
          </View>
          <Text style={styles.title}>This phone cannot run Locra yet</Text>
          <Text style={styles.body}>
            {compatibility.reason ??
              'This device does not meet the requirements to run the model on-device.'}
          </Text>
          <View style={styles.unsupportedNote}>
            <Text style={styles.unsupportedNoteText}>
              Nothing is broken. Locra just needs a supported Android device before it can load the
              model safely.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.centered}>
        <View style={styles.statusBadge}>
          <Text style={styles.statusBadgeText}>On-device model</Text>
        </View>
        <Text style={styles.title}>Get Locra ready</Text>
        <Text style={styles.body}>
          Locra downloads its vision model once. After that, photos and questions stay on this
          phone.
        </Text>

        <View style={styles.progressPanel}>
          <View style={styles.progressHeader}>
            <View style={styles.progressHeaderText}>
              <Text style={styles.progressKicker}>{getStageKicker(downloadStatus)}</Text>
              <Text style={styles.progressTitle}>{getStageTitle(downloadStatus)}</Text>
            </View>
            <Text style={styles.progressPercent}>{progressPercent}%</Text>
          </View>

          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, progressFillStyle]}>
              {downloadStatus === 'downloading' ? (
                <Animated.View style={[styles.progressSheen, shimmerStyle]} />
              ) : null}
            </Animated.View>
          </View>

          <Text style={styles.progressSubtext}>{getStageSubtext(downloadStatus)}</Text>

          <View style={styles.stepList}>
            {setupSteps.map((step) => (
              <View key={step.key} style={styles.stepRow}>
                <View
                  style={[
                    styles.stepDot,
                    step.state === 'done' && styles.stepDotDone,
                    step.state === 'active' && styles.stepDotActive,
                    step.state === 'paused' && styles.stepDotPaused,
                  ]}
                />
                <View style={styles.stepBody}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDetail}>{step.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {error !== null && downloadStatus === 'failed' ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Download stopped</Text>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        {notificationPermissionDenied ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Notifications are off</Text>
            <Text style={styles.noticeText}>
              Android may hide background progress. You can enable notifications for Locra in
              system settings.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        {primaryAction !== null ? (
          <Pressable
            key={downloadStatus}
            accessibilityRole="button"
            accessibilityLabel={primaryAction.accessibilityLabel}
            style={({ pressed }) => [
              primaryAction.variant === 'primary' ? styles.primaryButton : styles.secondaryButton,
              pressed && primaryAction.variant === 'primary' && styles.primaryButtonPressed,
              pressed && primaryAction.variant === 'secondary' && styles.secondaryButtonPressed,
            ]}
            onPress={() => {
              void onPrimaryAction();
            }}
          >
            <Text
              style={
                primaryAction.variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel
              }
            >
              {primaryAction.label}
            </Text>
          </Pressable>
        ) : null}

        {canCancel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel model download"
            style={({ pressed }) => [styles.ghostButton, pressed && styles.ghostButtonPressed]}
            onPress={onCancel}
          >
            <Text style={styles.ghostLabel}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

function getPrimaryAction(status: ModelDownloadStatus): PrimaryActionConfig | null {
  if (status === 'not_started') {
    return {
      action: 'start',
      label: 'Download model',
      accessibilityLabel: 'Download the model',
      variant: 'primary',
    };
  }
  if (status === 'failed') {
    return {
      action: 'start',
      label: 'Try again',
      accessibilityLabel: 'Try the model download again',
      variant: 'primary',
    };
  }
  if (status === 'downloading') {
    return {
      action: 'pause',
      label: 'Pause',
      accessibilityLabel: 'Pause the model download',
      variant: 'secondary',
    };
  }
  if (status === 'paused') {
    return {
      action: 'resume',
      label: 'Resume',
      accessibilityLabel: 'Resume the model download',
      variant: 'primary',
    };
  }
  return null;
}

function getStageKicker(status: ModelDownloadStatus): string {
  if (status === 'downloading') return 'Downloading';
  if (status === 'paused') return 'Paused';
  if (status === 'downloaded') return 'Ready';
  if (status === 'failed') return 'Needs attention';
  return 'Waiting';
}

function getStageTitle(status: ModelDownloadStatus): string {
  if (status === 'downloading') return 'Saving the model locally';
  if (status === 'paused') return 'Download is paused';
  if (status === 'downloaded') return 'Model verified';
  if (status === 'failed') return 'Could not finish the download';
  return 'Ready when you are';
}

function getStageSubtext(status: ModelDownloadStatus): string {
  if (status === 'downloading') return 'You can leave this screen open while the model arrives.';
  if (status === 'paused') return 'Resume continues from the saved progress.';
  if (status === 'downloaded') return 'Opening the camera now.';
  if (status === 'failed') return 'Try again when the connection is steady.';
  return 'This is the only setup step that needs the internet.';
}

function getSetupSteps(
  status: ModelDownloadStatus,
  progressPercent: number,
  integrityVerified: boolean
): SetupStep[] {
  return [
    {
      key: 'device',
      title: 'Device check',
      detail: 'This phone can run the model.',
      state: 'done',
    },
    {
      key: 'download',
      title: 'Model download',
      detail: getDownloadStepDetail(status, progressPercent),
      state: getDownloadStepState(status),
    },
    {
      key: 'verify',
      title: 'Integrity check',
      detail: integrityVerified
        ? 'The model file is verified.'
        : 'Runs automatically after download.',
      state: integrityVerified ? 'done' : status === 'downloaded' ? 'active' : 'pending',
    },
    {
      key: 'offline',
      title: 'Offline camera',
      detail: integrityVerified ? 'Ready for on-device answers.' : 'Unlocks after verification.',
      state: integrityVerified ? 'done' : 'pending',
    },
  ];
}

function getDownloadStepDetail(status: ModelDownloadStatus, progressPercent: number): string {
  if (status === 'downloading') return `${progressPercent}% saved on this phone.`;
  if (status === 'paused') return `${progressPercent}% saved. Resume when ready.`;
  if (status === 'downloaded') return 'Download complete.';
  if (status === 'failed') return 'Stopped before completion.';
  return 'Not started yet.';
}

function getDownloadStepState(status: ModelDownloadStatus): StepState {
  if (status === 'downloaded') return 'done';
  if (status === 'downloading') return 'active';
  if (status === 'paused') return 'paused';
  return 'pending';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.canvas,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.space5,
    paddingTop: theme.space6,
  },
  statusBadge: {
    alignSelf: 'center',
    paddingVertical: theme.space1,
    paddingHorizontal: theme.space3,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginBottom: theme.space4,
  },
  statusBadgeText: {
    color: theme.accent,
    fontSize: theme.fontSizeXs,
    fontWeight: '700',
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeXl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: theme.space3,
  },
  body: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
    textAlign: 'center',
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
    marginBottom: theme.space5,
  },
  progressPanel: {
    width: '100%',
    backgroundColor: theme.surface,
    borderRadius: theme.radiusLg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: theme.space4,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: theme.space4,
  },
  progressHeaderText: {
    flex: 1,
    marginRight: theme.space3,
  },
  progressKicker: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    fontWeight: '700',
    marginBottom: theme.space1,
  },
  progressTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
  },
  progressPercent: {
    color: theme.accent,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: theme.space3,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
    overflow: 'hidden',
  },
  progressSheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SHIMMER_WIDTH,
    backgroundColor: theme.textPrimary,
    opacity: 0.16,
  },
  progressSubtext: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
    marginTop: theme.space3,
  },
  stepList: {
    marginTop: theme.space4,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: theme.space3,
  },
  stepDot: {
    width: theme.space3,
    height: theme.space3,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.surface3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    marginTop: theme.space1,
    marginRight: theme.space3,
  },
  stepDotDone: {
    backgroundColor: theme.success,
    borderColor: theme.success,
  },
  stepDotActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  stepDotPaused: {
    backgroundColor: theme.accentGlow,
    borderColor: theme.accentBorder,
  },
  stepBody: {
    flex: 1,
  },
  stepTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
  },
  stepDetail: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeXs,
    lineHeight: theme.fontSizeXs * READABLE_LINE_HEIGHT_RATIO,
    marginTop: theme.space1,
  },
  unsupportedNote: {
    backgroundColor: theme.surface,
    borderRadius: theme.radiusLg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: theme.space4,
  },
  unsupportedNoteText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    textAlign: 'center',
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
  },
  errorCard: {
    marginTop: theme.space4,
    padding: theme.space4,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
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
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
  },
  noticeCard: {
    marginTop: theme.space4,
    padding: theme.space4,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
  },
  noticeTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
    marginBottom: theme.space2,
  },
  noticeText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: theme.space5,
    paddingTop: theme.space4,
    paddingBottom: theme.space4,
  },
  primaryButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.space4,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
  },
  primaryButtonPressed: {
    backgroundColor: theme.accentDim,
  },
  primaryLabel: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.space4,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
  },
  secondaryButtonPressed: {
    backgroundColor: theme.surface3,
  },
  secondaryLabel: {
    color: theme.accent,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
  },
  ghostButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.space4,
    marginLeft: theme.space3,
    borderRadius: theme.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    backgroundColor: theme.canvas,
  },
  ghostButtonPressed: {
    backgroundColor: theme.surface2,
  },
  ghostLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
  },
});
