import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { designTokens, haptics } from '../../constants/theme';
import { useVoiceStore } from '../../store/voiceStore';

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
      <Modal transparent animationType="fade" visible={disclosureVisible} onRequestClose={hideDisclosure}>
        <Pressable style={styles.scrim} onPress={hideDisclosure}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.title}>Enable offline voice</Text>
            <Text style={styles.body}>
              Voice audio stays on this device. Additional local storage is required
              {storageBytes === null ? '.' : ` (${formatStorage(storageBytes)}).`}
            </Text>
            <Pressable
              style={styles.primary}
              onPress={() => { void confirmEnable(); }}
            >
              <Text style={styles.primaryText}>Enable</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={hideDisclosure}>
              <Text style={styles.secondaryText}>Not now</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={error !== null && !disclosureVisible}
        onRequestClose={clearError}
      >
        <Pressable style={styles.scrim} onPress={clearError}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.title}>Voice unavailable</Text>
            <Text style={styles.body}>{error}</Text>
            <Pressable style={styles.primary} onPress={clearError}>
              <Text style={styles.primaryText}>Dismiss</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: designTokens.color.scrim },
  sheet: {
    padding: designTokens.spacing.space20, backgroundColor: designTokens.color.surfaceStrong,
    borderTopLeftRadius: designTokens.radius.card, borderTopRightRadius: designTokens.radius.card,
    borderTopWidth: designTokens.borderWidth, borderColor: designTokens.color.border,
  },
  title: {
    color: designTokens.color.textPrimary, fontSize: designTokens.type.sectionTitle.fontSize,
    fontWeight: designTokens.type.sectionTitle.fontWeight,
  },
  body: {
    color: designTokens.color.textSecondary, fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight, marginVertical: designTokens.spacing.space12,
  },
  primary: {
    minHeight: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: designTokens.radius.card, backgroundColor: designTokens.color.primary,
  },
  primaryText: { color: designTokens.color.onPrimary, fontWeight: designTokens.type.button.fontWeight },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: designTokens.color.textSecondary },
});
