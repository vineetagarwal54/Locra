import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

import { designTokens, haptics, theme } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { conversationStore } from '../store/conversationStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Capture'>;

const CAPTURE_BUTTON_SIZE = 72;
const CAPTURE_INNER_SIZE = 54;
const CAPTURE_PRESS_SCALE = 0.92;

export function CaptureScreen({ navigation, route }: Props) {
  const conversationId = route.params.conversationId;
  const [position, setPosition] = useState<'back' | 'front'>('back');
  const [captureError, setCaptureError] = useState<string | null>(null);

  const isFocused = useIsFocused();
  const device = useCameraDevice(position);
  const { hasPermission, requestPermission } = useCameraPermission();
  const photoOutput = usePhotoOutput({ qualityPrioritization: 'quality' });

  const scale = useSharedValue(1);
  const captureAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const goBackToChat = useCallback((): void => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.replace('Chat', { conversationId });
  }, [conversationId, navigation]);

  const onCapture = useCallback(async (): Promise<void> => {
    if (!device || !hasPermission) {
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
      conversationStore.setDraftImage(conversationId, toInferencePath(photo.filePath));
      goBackToChat();
    } catch {
      setCaptureError('The camera could not take that photo. Try once more.');
      void haptics.error();
    }
  }, [conversationId, device, goBackToChat, hasPermission, photoOutput, scale]);

  const onFlipCamera = useCallback((): void => {
    void haptics.tap();
    setPosition((prev) => (prev === 'back' ? 'front' : 'back'));
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to chat"
          style={styles.headerButton}
          onPress={goBackToChat}
        >
          <MaterialCommunityIcons
            name="chevron-left"
            size={28}
            color={designTokens.color.textSecondary}
          />
        </Pressable>
        <Text style={styles.title}>Camera</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.body}>
        <View style={styles.viewfinder}>
          {device && hasPermission ? (
            <Camera
              style={styles.camera}
              device={device}
              isActive={isFocused}
              outputs={[photoOutput]}
            />
          ) : (
            <View style={styles.cameraFallback}>
              <MaterialCommunityIcons
                name="camera-off-outline"
                size={designTokens.spacing.space24 * 2}
                color={designTokens.color.textSecondary}
              />
              <Text style={styles.fallbackTitle}>Camera is not ready</Text>
              <Text style={styles.fallbackText}>
                Allow camera access or choose Gallery from the chat composer.
              </Text>
            </View>
          )}
        </View>

        {captureError !== null ? <Text style={styles.errorText}>{captureError}</Text> : null}
      </View>

      <View style={styles.bottomBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Flip camera"
          disabled={!device || !hasPermission}
          style={({ pressed }) => [
            styles.sideButton,
            pressed && styles.sideButtonPressed,
            (!device || !hasPermission) && styles.disabled,
          ]}
          onPress={onFlipCamera}
        >
          <MaterialCommunityIcons
            name="camera-flip-outline"
            size={22}
            color={designTokens.color.textSecondary}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Capture photo"
          disabled={!device || !hasPermission}
          style={styles.capturePressable}
          onPress={() => {
            void onCapture();
          }}
        >
          <Animated.View
            style={[
              styles.captureButton,
              captureAnimatedStyle,
              (!device || !hasPermission) && styles.disabled,
            ]}
          >
            <View style={styles.captureInner} />
          </Animated.View>
        </Pressable>

        <View style={styles.sideButton} />
      </View>
    </SafeAreaView>
  );
}

function toInferencePath(path: string): string {
  return path.startsWith('file://') ? path.slice('file://'.length) : path;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: designTokens.color.canvas,
  },
  header: {
    minHeight: designTokens.spacing.space24 * 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designTokens.spacing.space16,
    borderBottomWidth: designTokens.borderWidth,
    borderBottomColor: designTokens.color.divider,
  },
  headerButton: {
    width: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24 * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.sectionTitle.fontSize,
    fontWeight: designTokens.type.sectionTitle.fontWeight,
  },
  body: {
    flex: 1,
    paddingHorizontal: designTokens.spacing.space16,
    paddingTop: designTokens.spacing.space16,
  },
  viewfinder: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  camera: {
    flex: 1,
  },
  cameraFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: designTokens.spacing.space20,
    backgroundColor: designTokens.color.surface,
  },
  fallbackTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.bodyStrong.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    marginTop: designTokens.spacing.space12,
    marginBottom: designTokens.spacing.space8,
  },
  fallbackText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    textAlign: 'center',
    lineHeight: designTokens.type.supporting.lineHeight,
  },
  errorText: {
    color: designTokens.color.error,
    fontSize: designTokens.type.supporting.fontSize,
    textAlign: 'center',
    marginTop: designTokens.spacing.space12,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designTokens.spacing.space24,
    paddingVertical: designTokens.spacing.space16,
  },
  sideButton: {
    width: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    backgroundColor: designTokens.color.surfaceStrong,
  },
  sideButtonPressed: {
    backgroundColor: designTokens.color.surface,
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
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surfaceStrong,
    borderWidth: designTokens.spacing.space4,
    borderColor: designTokens.color.primary,
  },
  captureInner: {
    width: CAPTURE_INNER_SIZE,
    height: CAPTURE_INNER_SIZE,
    borderRadius: designTokens.radius.pill,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  disabled: {
    opacity: 0.45,
  },
});
