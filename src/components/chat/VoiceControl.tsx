import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { designTokens, haptics } from '../../constants/theme';
import { openAndroidAppSettings } from '../../platform/AppSettings';
import { useVoiceStore } from '../../store/voiceStore';
import { VOICE_INPUT_ENABLED } from '../../voice/voiceFeature';
import { LocraSheet } from '../LocraSheet';

interface VoiceControlProps {
  readonly disabled: boolean;
  readonly onTranscript: (text: string) => void;
}

export function VoiceControl({ disabled, onTranscript }: VoiceControlProps) {
  const enabled = useVoiceStore((state) => state.enabled);
  const status = useVoiceStore((state) => state.status);
  const recording = useVoiceStore((state) => state.recording);
  const transcribing = useVoiceStore((state) => state.transcribing);
  const error = useVoiceStore((state) => state.error);
  const disclosureVisible = useVoiceStore((state) => state.disclosureVisible);
  const storageBytes = useVoiceStore((state) => state.storageBytes);
  const showDisclosure = useVoiceStore((state) => state.showDisclosure);
  const hideDisclosure = useVoiceStore((state) => state.hideDisclosure);
  const clearError = useVoiceStore((state) => state.clearError);
  const confirmEnable = useVoiceStore((state) => state.confirmEnable);
  const startRecording = useVoiceStore((state) => state.startRecording);
  const stopAndTranscribe = useVoiceStore((state) => state.stopAndTranscribe);
  const busy = disabled || transcribing;

  // Hidden until the offline voice runtime lands (voiceFeature.ts): showing a
  // control that can only ever error is worse than not showing it at all.
  if (!VOICE_INPUT_ENABLED) {
    return null;
  }

  const onPress = (): void => {
    void haptics.tap();
    if (!enabled || status !== 'ready') {
      showDisclosure();
      return;
    }
    if (recording) {
      void stopAndTranscribe().then((transcript) => {
        if (transcript !== '') {
          onTranscript(transcript);
        }
      });
      return;
    }
    void startRecording();
  };

  return (
    <>
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop voice recording' : 'Start voice input'}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          style={({ pressed }) => [
            styles.button,
            recording && styles.recording,
            pressed && !busy && styles.pressed,
            busy && styles.disabled,
          ]}
          onPress={onPress}
        >
          <MaterialCommunityIcons
            name={transcribing ? 'loading' : recording ? 'stop' : 'microphone-outline'}
            size={22}
            color={recording ? designTokens.color.onPrimary : designTokens.color.primary}
          />
        </Pressable>
      </View>

      <LocraSheet
        visible={disclosureVisible}
        title="Enable offline voice"
        message={
          'Voice audio stays on this device. Additional local storage is required' +
          (storageBytes === null ? '.' : ` (${formatStorage(storageBytes)}).`)
        }
        onRequestClose={hideDisclosure}
        actions={[
          { label: 'Enable', variant: 'primary', onPress: () => { void confirmEnable(); } },
          { label: 'Not now', variant: 'quiet', onPress: hideDisclosure },
        ]}
      />

      <LocraSheet
        visible={error !== null && !disclosureVisible}
        title="Voice unavailable"
        message={error ?? undefined}
        onRequestClose={clearError}
        actions={error?.toLowerCase().includes('permission') === true
          ? [
              { label: 'Open Android settings', variant: 'primary', onPress: () => { void openAndroidAppSettings(); } },
              { label: 'Dismiss', variant: 'quiet', onPress: clearError },
            ]
          : [{ label: 'Dismiss', variant: 'primary', onPress: clearError }]}
      />
    </>
  );
}

function formatStorage(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024))} MB`;
}

const styles = StyleSheet.create({
  button: {
    width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: designTokens.radius.pill, backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth, borderColor: designTokens.color.border,
  },
  recording: { backgroundColor: designTokens.color.primary, borderColor: designTokens.color.primary },
  pressed: { backgroundColor: designTokens.color.divider },
  disabled: { opacity: 0.45 },
});
