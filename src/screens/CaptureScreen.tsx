import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';

import { OfflineIndicator } from '../components/OfflineIndicator';
import { haptics, theme } from '../constants/theme';
// The sole sanctioned bridge import: useInferenceEngine IS the isolation boundary
// for the one `useLLM` call site, so the host that mounts it (this screen) wires
// it into the store here. All inference *state* still flows through the store.
import { useInferenceEngine } from '../inference/useInferenceEngine';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useInferenceStore } from '../store/inferenceStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Capture'>;

const CAPTURE_BUTTON_SIZE = 72;
const CAPTURE_BORDER_WIDTH = 3;
const CAPTURE_PRESS_SCALE = 0.92;

export function CaptureScreen({ navigation }: Props) {
  const [prompt, setPrompt] = useState('');
  const [position, setPosition] = useState<'back' | 'front'>('back');

  const status = useInferenceStore((s) => s.status);
  const submit = useInferenceStore((s) => s.submit);
  const registerEngine = useInferenceStore((s) => s.registerEngine);

  const engine = useInferenceEngine();
  useEffect(() => {
    registerEngine(engine);
    return () => registerEngine(null);
  }, [engine, registerEngine]);

  const isFocused = useIsFocused();
  const device = useCameraDevice(position);
  const { hasPermission, requestPermission } = useCameraPermission();
  const photoOutput = usePhotoOutput({ qualityPrioritization: 'quality' });

  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const inFlight = status === 'preprocessing' || status === 'loading_model' || status === 'streaming';
  const captureDisabled = inFlight || prompt.trim() === '';

  const scale = useSharedValue(1);
  const captureAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const onCapture = useCallback(async (): Promise<void> => {
    const question = prompt.trim();
    if (inFlight || question === '') {
      return;
    }
    scale.value = withSequence(
      withSpring(CAPTURE_PRESS_SCALE, theme.animationSpring),
      withSpring(1, theme.animationSpring),
    );
    void haptics.capture();
    try {
      const photo = await photoOutput.capturePhotoToFile({}, {});
      // Fire the inference (streamed on the Answer screen) — do NOT await it here.
      void submit({ imagePath: photo.filePath, question });
      navigation.navigate('Answer', { imagePath: photo.filePath, question });
    } catch {
      void haptics.error();
    }
  }, [prompt, inFlight, photoOutput, submit, navigation, scale]);

  const onOpenHistory = useCallback((): void => {
    void haptics.tap();
    navigation.navigate('History');
  }, [navigation]);

  const onFlipCamera = useCallback((): void => {
    void haptics.tap();
    setPosition((prev) => (prev === 'back' ? 'front' : 'back'));
  }, []);

  const onOpenGallery = useCallback((): void => {
    void haptics.tap();
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" style={styles.headerButton} onPress={onOpenHistory}>
          <Text style={styles.headerGlyph}>☰</Text>
        </Pressable>
        <Text style={styles.title}>Locra</Text>
        <OfflineIndicator />
      </View>

      <View style={styles.body}>
        {device && hasPermission ? (
          <Camera style={styles.camera} device={device} isActive={isFocused} outputs={[photoOutput]} />
        ) : (
          <View style={styles.cameraFallback}>
            <Text style={styles.fallbackText}>Camera unavailable</Text>
          </View>
        )}

        <View style={styles.promptWrap}>
          <TextInput
            style={styles.promptInput}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Ask anything about what you see…"
            placeholderTextColor={theme.textSecondary}
            multiline
          />
        </View>
      </View>

      <BlurView intensity={theme.blurCameraBar} tint="dark" style={styles.bottomBar}>
        <Pressable accessibilityRole="button" style={styles.sideButton} onPress={onOpenGallery}>
          <Text style={styles.sideGlyph}>▦</Text>
        </Pressable>

        <Pressable accessibilityRole="button" disabled={captureDisabled} onPress={onCapture}>
          <Animated.View
            style={[styles.captureButton, captureAnimatedStyle, captureDisabled && styles.captureDisabled]}
          />
        </Pressable>

        <Pressable accessibilityRole="button" style={styles.sideButton} onPress={onFlipCamera}>
          <Text style={styles.sideGlyph}>⟲</Text>
        </Pressable>
      </BlurView>
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
    fontSize: theme.fontSizeLg,
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
  camera: {
    flex: 1,
    borderRadius: theme.radiusLg,
    overflow: 'hidden',
  },
  cameraFallback: {
    flex: 1,
    borderRadius: theme.radiusLg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
  },
  fallbackText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
  },
  promptWrap: {
    marginTop: theme.space4,
  },
  promptInput: {
    minHeight: theme.space6,
    paddingHorizontal: theme.space4,
    paddingVertical: theme.space3,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space6,
    paddingVertical: theme.space4,
  },
  sideButton: {
    width: theme.space6,
    height: theme.space6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideGlyph: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeXl,
  },
  captureButton: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.textPrimary,
    borderWidth: CAPTURE_BORDER_WIDTH,
    borderColor: theme.accent,
  },
  captureDisabled: {
    opacity: 0.5,
  },
});
