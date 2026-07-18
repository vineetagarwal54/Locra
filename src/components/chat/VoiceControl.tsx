import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { designTokens } from '../../constants/theme';
import { openAndroidAppSettings } from '../../platform/AppSettings';
import { useVoiceStore } from '../../store/voiceStore';
import { LocraSheet } from '../LocraSheet';

import type { VoiceMicMode } from './useVoiceDictation';

interface VoiceMicButtonProps {
  readonly mode: VoiceMicMode;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

/**
 * The composer's microphone / stop control. Presentational only — all session
 * orchestration lives in {@link useVoiceDictation}. While recording it becomes a
 * clear Stop control; while finalizing it shows a busy spinner.
 */
export function VoiceMicButton({ mode, disabled, onPress }: VoiceMicButtonProps) {
  const recording = mode === 'recording';
  const busy = mode === 'transcribing';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? 'Stop voice recording' : 'Start voice input'}
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        recording && styles.recording,
        pressed && !disabled && !busy && styles.pressed,
        (disabled || busy) && styles.disabled,
      ]}
      onPress={onPress}
    >
      <MaterialCommunityIcons
        name={busy ? 'loading' : recording ? 'stop' : 'microphone-outline'}
        size={22}
        color={recording ? designTokens.color.onPrimary : designTokens.color.primary}
      />
    </Pressable>
  );
}

// Animated audio-level bars shown WHILE recording, in place of any live text.
// The user sees motion + a timer + Stop + Cancel — never a partial transcript.
const BAR_DELAYS_MS = [0, 110, 220, 110, 0];

export function VoiceRecordingBars() {
  return (
    <View style={barStyles.row} accessibilityLabel="Recording audio">
      {BAR_DELAYS_MS.map((delay, index) => (
        <RecordingBar key={index} delay={delay} />
      ))}
    </View>
  );
}

function RecordingBar({ delay }: { delay: number }) {
  const scale = useSharedValue(0.4);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      scale.value = 0.7;
      return;
    }
    scale.value = withDelay(delay, withRepeat(withTiming(1, { duration: 360 }), -1, true));
  }, [delay, reduceMotion, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.value }] }));
  return <Animated.View style={[barStyles.bar, style]} />;
}

/**
 * The voice setup + error sheets. Handles explicit model-enable confirmation
 * (with disclosed storage size), permission recovery via Android settings, and
 * retry/removal when voice-model setup fails.
 */
export function VoiceSheets() {
  const status = useVoiceStore((state) => state.status);
  const modelError = useVoiceStore((state) => state.error);
  const sessionError = useVoiceStore((state) => state.sessionError);
  const disclosureVisible = useVoiceStore((state) => state.disclosureVisible);
  const storageBytes = useVoiceStore((state) => state.storageBytes);
  const hideDisclosure = useVoiceStore((state) => state.hideDisclosure);
  const clearError = useVoiceStore((state) => state.clearError);
  const confirmEnable = useVoiceStore((state) => state.confirmEnable);
  const removeModel = useVoiceStore((state) => state.removeModel);

  const activeError = sessionError ?? modelError;
  const lowerError = activeError?.toLowerCase() ?? '';
  const isPermissionError =
    lowerError.includes('permission') || lowerError.includes('microphone access');
  const isNoSpeech = lowerError.includes('no speech');
  const isSetupError = status === 'error';

  return (
    <>
      <LocraSheet
        visible={disclosureVisible}
        title="Enable offline voice"
        message={
          'Voice runs entirely on this device — audio never leaves your phone. ' +
          'Setting it up downloads a speech model' +
          (storageBytes === null ? '' : ` (about ${formatStorage(storageBytes)})`) +
          ' and asks for microphone access. Continue?'
        }
        onRequestClose={hideDisclosure}
        actions={[
          { label: 'Download & enable', variant: 'primary', onPress: () => { void confirmEnable(); } },
          { label: 'Not now', variant: 'quiet', onPress: hideDisclosure },
        ]}
      />

      <LocraSheet
        visible={activeError !== null && !disclosureVisible}
        title={
          isPermissionError
            ? 'Microphone access needed'
            : isNoSpeech
              ? 'No speech detected'
              : isSetupError
                ? 'Voice setup failed'
                : 'Voice input'
        }
        message={activeError ?? undefined}
        onRequestClose={clearError}
        actions={buildErrorActions({
          isPermissionError,
          isSetupError,
          onRetry: () => { void confirmEnable(); },
          onRemove: () => { void removeModel(); },
          onSettings: () => { void openAndroidAppSettings(); },
          onDismiss: clearError,
        })}
      />
    </>
  );
}

function buildErrorActions(input: {
  isPermissionError: boolean;
  isSetupError: boolean;
  onRetry: () => void;
  onRemove: () => void;
  onSettings: () => void;
  onDismiss: () => void;
}): { label: string; variant: 'primary' | 'quiet' | 'destructive'; onPress: () => void }[] {
  if (input.isPermissionError) {
    return [
      { label: 'Open Android settings', variant: 'primary', onPress: input.onSettings },
      { label: 'Dismiss', variant: 'quiet', onPress: input.onDismiss },
    ];
  }
  if (input.isSetupError) {
    return [
      { label: 'Retry setup', variant: 'primary', onPress: input.onRetry },
      { label: 'Remove voice model', variant: 'destructive', onPress: input.onRemove },
      { label: 'Dismiss', variant: 'quiet', onPress: input.onDismiss },
    ];
  }
  return [{ label: 'Dismiss', variant: 'primary', onPress: input.onDismiss }];
}

function formatStorage(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024))} MB`;
}

const styles = StyleSheet.create({
  button: {
    width: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  recording: { backgroundColor: designTokens.color.primary, borderColor: designTokens.color.primary },
  pressed: { backgroundColor: designTokens.color.divider },
  disabled: { opacity: 0.45 },
});

const barStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: designTokens.spacing.space20,
  },
  bar: {
    width: 3,
    height: designTokens.spacing.space16,
    marginRight: 3,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.primary,
  },
});
