import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';

import { OfflineIndicator } from '../components/OfflineIndicator';
import { VoiceButton } from '../components/VoiceButton';
import { haptics, theme } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useInferenceStore } from '../store/inferenceStore';
import { useMediaStore } from '../store/mediaStore';
import { useVoiceStore, type VoicePhase } from '../store/voiceStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Capture'>;

const CAPTURE_BUTTON_SIZE = 72;
const CAPTURE_INNER_SIZE = 54;
const CAPTURE_PRESS_SCALE = 0.92;
const READABLE_LINE_HEIGHT_RATIO = 1.45;

export function CaptureScreen({ navigation }: Props) {
  const [prompt, setPrompt] = useState('');
  const [selectedImagePath, setSelectedImagePath] = useState<string | null>(null);
  const [position, setPosition] = useState<'back' | 'front'>('back');
  const [captureError, setCaptureError] = useState<string | null>(null);

  const status = useInferenceStore((s) => s.status);
  const submit = useInferenceStore((s) => s.submit);
  const pickImageFromLibrary = useMediaStore((s) => s.pickImageFromLibrary);
  const voicePhase = useVoiceStore((s) => s.phase);
  const voiceProgress = useVoiceStore((s) => s.downloadProgress);
  const voiceError = useVoiceStore((s) => s.error);

  const isFocused = useIsFocused();
  const device = useCameraDevice(position);
  const { hasPermission, requestPermission } = useCameraPermission();
  const photoOutput = usePhotoOutput({ qualityPrioritization: 'quality' });

  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // FR-047: returning to the camera means the previous chat thread is over.
  // Its completed turns are already committed to history, so reset the active
  // chat (and the engine's conversation memory) for a clean slate per capture.
  useEffect(() => {
    return navigation.addListener('focus', () => {
      useInferenceStore.getState().resetActiveChat();
    });
  }, [navigation]);

  const inFlight =
    status === 'preprocessing' || status === 'loading_model' || status === 'streaming';
  const hasImage = selectedImagePath !== null;
  const trimmedPrompt = prompt.trim();
  const captureDisabled = inFlight || !device || !hasPermission;
  const submitDisabled = inFlight || !hasImage || trimmedPrompt === '';

  const scale = useSharedValue(1);
  const captureAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const onCapture = useCallback(async (): Promise<void> => {
    if (captureDisabled) {
      return;
    }
    setCaptureError(null);
    scale.value = withSequence(
      withSpring(CAPTURE_PRESS_SCALE, theme.animationSpring),
      withSpring(1, theme.animationSpring)
    );
    void haptics.capture();
    try {
      const photo = await photoOutput.capturePhotoToFile({}, {});
      setSelectedImagePath(toInferencePath(photo.filePath));
    } catch {
      setCaptureError('The camera could not take that photo. Try once more.');
      void haptics.error();
    }
  }, [captureDisabled, photoOutput, scale]);

  const onSubmit = useCallback((): void => {
    if (selectedImagePath === null || submitDisabled) {
      return;
    }
    setCaptureError(null);
    void haptics.tap();
    void submit({ imagePath: selectedImagePath, question: trimmedPrompt }).catch(() => {
      void haptics.error();
    });
    navigation.navigate('Answer', { imagePath: selectedImagePath, question: trimmedPrompt });
  }, [navigation, selectedImagePath, submit, submitDisabled, trimmedPrompt]);

  const onOpenHistory = useCallback((): void => {
    void haptics.tap();
    navigation.navigate('History');
  }, [navigation]);

  const onFlipCamera = useCallback((): void => {
    if (hasImage || inFlight) {
      return;
    }
    void haptics.tap();
    setPosition((prev) => (prev === 'back' ? 'front' : 'back'));
  }, [hasImage, inFlight]);

  const onRetake = useCallback((): void => {
    if (inFlight) {
      return;
    }
    void haptics.tap();
    setSelectedImagePath(null);
    setCaptureError(null);
  }, [inFlight]);

  const onVoiceTranscript = useCallback((text: string): void => {
    // Dictation fills the field for review/edit — it never auto-submits (FR-033).
    setPrompt((prev) => (prev.trim() === '' ? text : `${prev.trim()} ${text}`));
  }, []);

  const onOpenGallery = useCallback(async (): Promise<void> => {
    if (inFlight) {
      return;
    }
    setCaptureError(null);
    void haptics.tap();
    try {
      const localPath = await pickImageFromLibrary();
      if (localPath === null) {
        return;
      }
      setSelectedImagePath(localPath);
    } catch {
      setCaptureError('That photo could not be opened. Choose a different image.');
      void haptics.error();
    }
  }, [inFlight, pickImageFromLibrary]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open history"
          style={styles.headerButton}
          onPress={onOpenHistory}
        >
          <Text style={styles.headerGlyph}>History</Text>
        </Pressable>
        <Text style={styles.title}>Locra</Text>
        <OfflineIndicator />
      </View>

      <KeyboardAvoidingView style={styles.keyboardAvoider} behavior="padding">
        <View style={styles.body}>
          <View style={styles.viewfinder}>
            {selectedImagePath !== null ? (
              <Image
                style={styles.previewImage}
                source={{ uri: toPreviewUri(selectedImagePath) }}
                contentFit="cover"
              />
            ) : device && hasPermission ? (
              <Camera
                style={styles.camera}
                device={device}
                isActive={isFocused && selectedImagePath === null}
                outputs={[photoOutput]}
              />
            ) : (
              <View style={styles.cameraFallback}>
                <Text style={styles.fallbackTitle}>Camera is not ready</Text>
                <Text style={styles.fallbackText}>
                  You can still choose a photo from your phone.
                </Text>
              </View>
            )}
          </View>

          {selectedImagePath !== null ? (
            <View style={styles.promptWrap}>
              <View style={styles.promptRow}>
                <TextInput
                  style={styles.promptInput}
                  value={prompt}
                  onChangeText={setPrompt}
                  placeholder="Ask about this photo, or hold the mic to talk"
                  placeholderTextColor={theme.textSecondary}
                  multiline
                />
                <VoiceButton disabled={inFlight} onTranscript={onVoiceTranscript} />
              </View>
              {voiceHintFor(voicePhase, voiceProgress, voiceError) !== null ? (
                <Text
                  style={[styles.voiceHint, voicePhase === 'error' && styles.voiceHintError]}
                >
                  {voiceHintFor(voicePhase, voiceProgress, voiceError)}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.captureHint}>
              Take a photo first, then ask a question about it.
            </Text>
          )}

          {captureError !== null ? <Text style={styles.errorText}>{captureError}</Text> : null}
        </View>

        <BlurView intensity={theme.blurCameraBar} tint="dark" style={styles.bottomBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose a photo"
            disabled={inFlight}
            style={({ pressed }) => [
              styles.sideButton,
              pressed && styles.sideButtonPressed,
              inFlight && styles.disabled,
            ]}
            onPress={onOpenGallery}
          >
            <Text style={styles.sideLabel}>Photos</Text>
          </Pressable>

          {selectedImagePath === null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Capture photo"
              disabled={captureDisabled}
              style={styles.capturePressable}
              onPress={onCapture}
            >
              <Animated.View
                style={[
                  styles.captureButton,
                  captureAnimatedStyle,
                  captureDisabled && styles.disabled,
                ]}
              >
                <View style={styles.captureInner} />
              </Animated.View>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Submit question"
              disabled={submitDisabled}
              style={({ pressed }) => [
                styles.submitButton,
                pressed && !submitDisabled && styles.submitButtonPressed,
                submitDisabled && styles.disabled,
              ]}
              onPress={onSubmit}
            >
              <Text style={styles.submitLabel}>{inFlight ? 'Working' : 'Ask'}</Text>
            </Pressable>
          )}

          {selectedImagePath === null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Flip camera"
              disabled={captureDisabled}
              style={({ pressed }) => [
                styles.sideButton,
                pressed && styles.sideButtonPressed,
                captureDisabled && styles.disabled,
              ]}
              onPress={onFlipCamera}
            >
              <Text style={styles.sideLabel}>Flip</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retake photo"
              disabled={inFlight}
              style={({ pressed }) => [
                styles.sideButton,
                pressed && styles.sideButtonPressed,
                inFlight && styles.disabled,
              ]}
              onPress={onRetake}
            >
              <Text style={styles.sideLabel}>Retake</Text>
            </Pressable>
          )}
        </BlurView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function toPreviewUri(path: string): string {
  if (path.startsWith('file://') || path.startsWith('content://')) {
    return path;
  }
  return `file://${path}`;
}

function toInferencePath(path: string): string {
  return path.startsWith('file://') ? path.slice('file://'.length) : path;
}

function voiceHintFor(
  phase: VoicePhase,
  progress: number,
  error: string | null
): string | null {
  if (phase === 'loading') {
    return `Preparing voice… ${Math.round(progress * 100)}%`;
  }
  if (phase === 'recording') {
    return 'Listening… release to add it to your question';
  }
  if (phase === 'transcribing') {
    return 'Transcribing…';
  }
  if (phase === 'error') {
    return error ?? 'Voice input is unavailable right now.';
  }
  return null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.canvas,
  },
  keyboardAvoider: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space4,
    paddingVertical: theme.space3,
  },
  headerButton: {
    minWidth: theme.space6,
    height: theme.space6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerGlyph: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    fontWeight: '600',
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    paddingHorizontal: theme.space4,
  },
  viewfinder: {
    flex: 1,
    borderRadius: theme.radiusLg,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  camera: {
    flex: 1,
  },
  previewImage: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.surface,
  },
  cameraFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space5,
    backgroundColor: theme.surface,
  },
  fallbackTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
    marginBottom: theme.space2,
  },
  fallbackText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    textAlign: 'center',
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
  },
  promptWrap: {
    marginTop: theme.space4,
  },
  promptRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.space2,
  },
  promptInput: {
    flex: 1,
    minHeight: theme.space6 * 3,
    paddingHorizontal: theme.space4,
    paddingVertical: theme.space3,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
  },
  voiceHint: {
    marginTop: theme.space2,
    marginLeft: theme.space2,
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
  },
  voiceHintError: {
    color: theme.error,
  },
  captureHint: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    textAlign: 'center',
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
    marginTop: theme.space3,
  },
  errorText: {
    color: theme.error,
    fontSize: theme.fontSizeSm,
    textAlign: 'center',
    marginTop: theme.space3,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space5,
    paddingVertical: theme.space4,
  },
  sideButton: {
    minWidth: theme.space6 * 3,
    height: theme.space6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space3,
    borderRadius: theme.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    backgroundColor: theme.surface,
  },
  sideButtonPressed: {
    backgroundColor: theme.surface3,
  },
  sideLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
  },
  capturePressable: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButton: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.textPrimary,
    borderWidth: theme.space1,
    borderColor: theme.accent,
  },
  captureInner: {
    width: CAPTURE_INNER_SIZE,
    height: CAPTURE_INNER_SIZE,
    borderRadius: theme.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
  },
  submitButton: {
    minWidth: theme.space6 * 5,
    height: theme.space6 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
  },
  submitButtonPressed: {
    backgroundColor: theme.accentDim,
  },
  submitLabel: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
});
