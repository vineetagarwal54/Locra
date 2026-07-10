import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { designTokens, haptics, theme } from '../constants/theme';
import { useVoiceStore } from '../store/voiceStore';

// Hold-to-record mic button (FR-033). Press-and-hold to dictate; release to
// transcribe. The recognized text is handed back via onTranscript for the user
// to review and edit — it never auto-submits. First use lazily enables voice
// (mounts the host, which downloads the Whisper model); subsequent holds record.

const PULSE_MS = 700;
const RECORDING_SCALE = 1.12;

interface VoiceButtonProps {
  /** True while a VLM inference is running — voice is blocked (mutual exclusion). */
  disabled: boolean;
  onTranscript: (text: string) => void;
}

export function VoiceButton({ disabled, onTranscript }: VoiceButtonProps) {
  const enabled = useVoiceStore((s) => s.enabled);
  const phase = useVoiceStore((s) => s.phase);
  const enableVoice = useVoiceStore((s) => s.enableVoice);
  const startRecording = useVoiceStore((s) => s.startRecording);
  const stopAndTranscribe = useVoiceStore((s) => s.stopAndTranscribe);
  const cancel = useVoiceStore((s) => s.cancel);

  const recordingRef = useRef(false);
  const isRecording = phase === 'recording';
  const isBusy = phase === 'loading' || phase === 'transcribing';

  const pulse = useSharedValue(1);
  useEffect(() => {
    if (isRecording) {
      pulse.value = withRepeat(withTiming(RECORDING_SCALE, { duration: PULSE_MS }), -1, true);
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: theme.animationTiming });
    }
  }, [isRecording, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  // Release any in-flight recording if this control unmounts mid-hold.
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        cancel();
      }
    };
  }, [cancel]);

  const onPressIn = (): void => {
    if (disabled || isBusy) {
      return;
    }
    if (!enabled) {
      // First use: begin downloading/preparing the voice model. The user lifts
      // and holds again once it is ready.
      enableVoice();
      void haptics.tap();
      return;
    }
    if (phase !== 'ready') {
      return;
    }
    void haptics.capture();
    recordingRef.current = true;
    void startRecording().catch(() => {
      recordingRef.current = false;
      void haptics.error();
    });
  };

  const onPressOut = (): void => {
    if (!recordingRef.current) {
      return;
    }
    recordingRef.current = false;
    void stopAndTranscribe()
      .then((text) => {
        if (text.trim() !== '') {
          onTranscript(text.trim());
          void haptics.success();
        }
      })
      .catch(() => {
        void haptics.error();
      });
  };

  const iconColor = disabled
    ? designTokens.color.textSecondary
    : isRecording
      ? designTokens.color.error
      : designTokens.color.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isRecording ? 'Release to transcribe' : 'Hold to dictate a question'}
      accessibilityState={{ disabled, busy: isBusy }}
      disabled={disabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={designTokens.spacing.space8}
      style={({ pressed }) => [
        styles.button,
        isRecording && styles.buttonRecording,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Animated.View style={pulseStyle}>
        {isBusy ? (
          <ActivityIndicator size="small" color={designTokens.color.primary} />
        ) : (
          <MaterialCommunityIcons
            name={isRecording ? 'microphone' : 'microphone-outline'}
            size={designTokens.type.sectionTitle.fontSize}
            color={iconColor}
          />
        )}
      </Animated.View>
    </Pressable>
  );
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
  buttonRecording: {
    backgroundColor: designTokens.color.errorSurface,
    borderColor: designTokens.color.error,
  },
  buttonPressed: {
    backgroundColor: designTokens.color.divider,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
