import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  OnboardingScreen,
  PrimaryButton,
  SecondaryTextButton,
  SetupStateIcon,
} from '../components/onboarding/OnboardingKit';
import { designTokens } from '../constants/theme';
import { createQwenModelPresentation } from '../model/ModelPresentation';
import { getStorageAvailability, isStorageError } from '../model/StorageCheck';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useModelStore } from '../store/modelStore';
import type { ModelDownloadStatus, ModelSetupPhase } from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'DownloadProgress'>;

const PROGRESS_MIN_PERCENT = 2;
const PROGRESS_ANIM_MS = 250;

export function DownloadProgressScreen({ navigation, route }: Props) {
  const presentation = createQwenModelPresentation();
  const autoStart = route.params?.autoStart ?? false;

  const downloadStatus = useModelStore((s) => s.downloadStatus);
  const setupPhase = useModelStore((s) => s.setupPhase);
  const downloadProgress = useModelStore((s) => s.downloadProgress);
  const integrityVerified = useModelStore((s) => s.integrityVerified);
  const error = useModelStore((s) => s.error);
  const cellularWarningVisible = useModelStore((s) => s.cellularDownloadWarningVisible);

  const startDownload = useModelStore((s) => s.startDownload);
  const confirmCellularDownload = useModelStore((s) => s.confirmCellularDownload);
  const dismissCellularDownloadWarning = useModelStore((s) => s.dismissCellularDownloadWarning);
  const resumeDownload = useModelStore((s) => s.resumeDownload);
  const cancelDownload = useModelStore((s) => s.cancelDownload);

  const progress = clampProgress(downloadProgress);
  const progressPercent = Math.round(progress * 100);
  const isReady = setupPhase === 'ready' && integrityVerified;
  const reduceMotion = useReducedMotion();

  // Start from the real current progress so a reattached download never replays
  // its bar from 0 (motion.md §7.5).
  const progressValue = useSharedValue(progress);
  useEffect(() => {
    const next = Math.max(PROGRESS_MIN_PERCENT / 100, progress);
    progressValue.value = reduceMotion ? next : withTiming(next, { duration: PROGRESS_ANIM_MS });
  }, [progress, progressValue, reduceMotion]);
  const progressFillStyle = useAnimatedStyle(() => ({
    width: `${progressValue.value * 100}%`,
  }));

  // Kick off the download once, only when arriving fresh from the rationale
  // screen and nothing is already in flight. Reads the live store snapshot
  // imperatively so this stays a one-shot on mount without depending on the
  // reactive status/action values. The download/network-gate logic in the store
  // is unchanged; the cellular warning surfaces below if it triggers.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    const store = useModelStore.getState();
    if (
      autoStart &&
      (store.setupPhase === 'not_installed' || store.setupPhase === 'failed')
    ) {
      void (async () => {
        // Pre-flight free-space gate: route to the recovery screen before
        // spending bandwidth on a download that cannot fit (design.md §7.7).
        // If free space can't be read, getStorageAvailability reports
        // `sufficient: true` so a real ENOSPC still surfaces via the download.
        const availability = await getStorageAvailability(presentation.storageRequiredBytes);
        if (!availability.sufficient) {
          navigation.replace('InsufficientStorage');
          return;
        }
        void store.startDownload();
      })();
    }
  }, [autoStart, navigation, presentation.storageRequiredBytes]);

  // Setup completed and verified → confirm with the Success screen (design.md §7.6).
  useEffect(() => {
    if (isReady) {
      navigation.replace('Success');
    }
  }, [isReady, navigation]);

  // Storage-related download failures route to the dedicated recovery screen
  // instead of the generic failed card (design.md §7.7). Non-storage failures
  // keep the existing in-place "Download needs attention" retry state.
  useEffect(() => {
    if (downloadStatus === 'failed' && isStorageError(error)) {
      navigation.replace('InsufficientStorage');
    }
  }, [downloadStatus, error, navigation]);

  const goBackToIntro = useCallback((): void => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.replace('ModelIntro');
    }
  }, [navigation]);

  const onCancel = useCallback((): void => {
    void cancelDownload();
    goBackToIntro();
  }, [cancelDownload, goBackToIntro]);

  const onResume = useCallback((): void => {
    void resumeDownload();
  }, [resumeDownload]);

  const onRetry = useCallback((): void => {
    void startDownload();
  }, [startDownload]);

  const onWaitForWifi = useCallback((): void => {
    dismissCellularDownloadWarning();
    goBackToIntro();
  }, [dismissCellularDownloadWarning, goBackToIntro]);

  const onDownloadAnyway = useCallback((): void => {
    void confirmCellularDownload();
  }, [confirmCellularDownload]);

  const isFailed = setupPhase === 'failed';
  const phase = getPhase(setupPhase);

  return (
    <OnboardingScreen
      center
      footer={
        cellularWarningVisible ? undefined : (
          <SetupFooter
            status={downloadStatus}
            setupPhase={setupPhase}
            onCancel={onCancel}
            onResume={onResume}
            onRetry={onRetry}
          />
        )
      }
    >
      <View style={styles.iconWrap}>
        <SetupStateIcon icon={isFailed ? 'alert-outline' : 'tray-arrow-down'} tone="neutral" />
      </View>

      <Text style={styles.title}>
        {isFailed
          ? 'Setup needs attention'
          : setupPhase === 'verifying'
            ? 'Verifying model…'
            : setupPhase === 'preparing'
              ? 'Preparing on-device AI…'
              : 'Downloading model…'}
      </Text>

      <View style={styles.chip}>
        <MaterialCommunityIcons
          name="cube-outline"
          size={designTokens.type.supporting.fontSize}
          color={designTokens.color.primary}
        />
        <Text style={styles.chipText}>{presentation.displayName}</Text>
      </View>

      {cellularWarningVisible ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>This looks like mobile data</Text>
          <Text style={styles.warningText}>
            {`The model is about ${presentation.downloadSizeLabel}. Wait for Wi-Fi, or continue now on mobile data.`}
          </Text>
          <View style={styles.warningActions}>
            <View style={styles.warningActionLeft}>
              <SecondaryTextButton
                label="Wait for Wi-Fi"
                onPress={onWaitForWifi}
                accessibilityLabel="Wait for Wi-Fi before downloading"
              />
            </View>
            <View style={styles.warningActionRight}>
              <PrimaryButton
                label="Download anyway"
                onPress={onDownloadAnyway}
                accessibilityLabel="Download the model using mobile data"
              />
            </View>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressPercent}>{progressPercent}%</Text>
              <Text style={styles.progressBytes}>{presentation.formatDownloadedOfTotal(progress)}</Text>
            </View>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, progressFillStyle]} />
            </View>
            <View style={styles.phaseRow}>
              <MaterialCommunityIcons
                name={isFailed ? 'alert-circle-outline' : 'sync'}
                size={designTokens.type.caption.fontSize}
                color={isFailed ? designTokens.color.error : designTokens.color.textSecondary}
              />
              <Text style={[styles.phaseText, isFailed && styles.phaseTextError]}>{phase}</Text>
            </View>
          </View>

          {isFailed && error !== null ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : (
            <Text style={styles.note}>
              You can leave Locra while the model downloads. Progress will appear in your
              notifications.
            </Text>
          )}
        </>
      )}
    </OnboardingScreen>
  );
}

interface SetupFooterProps {
  status: ModelDownloadStatus;
  setupPhase: ModelSetupPhase;
  onCancel: () => void;
  onResume: () => void;
  onRetry: () => void;
}

function SetupFooter({ status, setupPhase, onCancel, onResume, onRetry }: SetupFooterProps) {
  if (setupPhase === 'verifying' || setupPhase === 'preparing') return null;
  if (status === 'failed') {
    return (
      <View>
        <PrimaryButton label="Try again" onPress={onRetry} accessibilityLabel="Try the download again" />
        <SecondaryTextButton label="Back" onPress={onCancel} accessibilityLabel="Go back to setup" />
      </View>
    );
  }
  if (status === 'paused') {
    return (
      <View>
        <PrimaryButton label="Resume" onPress={onResume} accessibilityLabel="Resume the download" />
        <SecondaryTextButton label="Cancel" onPress={onCancel} accessibilityLabel="Cancel the download" />
      </View>
    );
  }
  return (
    <SecondaryTextButton label="Cancel" onPress={onCancel} accessibilityLabel="Cancel the download" />
  );
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function getPhase(phase: ModelSetupPhase): string {
  if (phase === 'downloading') return 'Downloading…';
  if (phase === 'paused') return 'Download paused';
  if (phase === 'verifying') return 'Verifying model…';
  if (phase === 'failed') return 'Setup needs attention';
  if (phase === 'ready') return 'Model ready';
  return 'Preparing download…';
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    marginBottom: designTokens.spacing.space16,
  },
  title: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.screenTitle.fontSize,
    fontWeight: designTokens.type.screenTitle.fontWeight,
    lineHeight: designTokens.type.screenTitle.lineHeight,
    textAlign: 'center',
    marginBottom: designTokens.spacing.space16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingVertical: designTokens.spacing.space8,
    paddingHorizontal: designTokens.spacing.space12,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginBottom: designTokens.spacing.space24,
  },
  chipText: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.supporting.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    marginLeft: designTokens.spacing.space8,
  },
  progressCard: {
    backgroundColor: designTokens.color.surfaceStrong,
    borderRadius: designTokens.radius.card,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    padding: designTokens.spacing.space16,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: designTokens.spacing.space12,
  },
  progressPercent: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.screenTitle.fontSize,
    fontWeight: designTokens.type.screenTitle.fontWeight,
    fontVariant: ['tabular-nums'],
  },
  progressBytes: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: designTokens.spacing.space8,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.divider,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.primary,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: designTokens.spacing.space12,
  },
  phaseText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
    fontWeight: designTokens.type.caption.fontWeight,
    letterSpacing: 0.5,
    marginLeft: designTokens.spacing.space8,
  },
  phaseTextError: {
    color: designTokens.color.error,
  },
  note: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
    textAlign: 'center',
    marginTop: designTokens.spacing.space20,
  },
  errorText: {
    color: designTokens.color.error,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
    textAlign: 'center',
    marginTop: designTokens.spacing.space20,
  },
  warningCard: {
    backgroundColor: designTokens.color.surface,
    borderRadius: designTokens.radius.card,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    padding: designTokens.spacing.space16,
  },
  warningTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.cardTitle.fontSize,
    fontWeight: designTokens.type.cardTitle.fontWeight,
    marginBottom: designTokens.spacing.space8,
  },
  warningText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
  },
  warningActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: designTokens.spacing.space12,
  },
  warningActionLeft: {
    flex: 1,
  },
  warningActionRight: {
    flex: 1,
  },
});
