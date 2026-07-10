import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  OnboardingScreen,
  PrimaryButton,
  SetupStateIcon,
} from '../components/onboarding/OnboardingKit';
import { designTokens, haptics } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Success'>;

// motion.md §7.6 — icon settles (scale 0.92 → 1), then title/subtitle/CTA fade
// in; total entry finishes within ~400 ms.
const ICON_SETTLE_MS = 400;
const TITLE_DELAY_MS = 120;
const SUBTITLE_DELAY_MS = 200;
const CTA_DELAY_MS = 280;
const TEXT_DURATION_MS = 240;

export function SuccessScreen({ navigation }: Props) {
  const reduceMotion = useReducedMotion();

  // motion.md §16 — model setup success gets one light success haptic.
  useEffect(() => {
    void haptics.success();
  }, []);

  const iconScale = useSharedValue(reduceMotion ? 1 : 0.92);
  useEffect(() => {
    iconScale.value = reduceMotion ? 1 : withTiming(1, { duration: ICON_SETTLE_MS });
  }, [iconScale, reduceMotion]);
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  const onStartChatting = useCallback((): void => {
    // Only reached after model verification succeeds (design.md §7.6 / §15).
    navigation.replace('Chat', { conversationId: 'new' });
  }, [navigation]);

  const textEntry = (delay: number) =>
    reduceMotion ? undefined : FadeInDown.duration(TEXT_DURATION_MS).delay(delay);

  return (
    <OnboardingScreen
      center
      footer={
        <Animated.View entering={reduceMotion ? undefined : FadeIn.delay(CTA_DELAY_MS)}>
          <PrimaryButton
            label="Start chatting"
            icon="arrow-right"
            onPress={onStartChatting}
            accessibilityLabel="Start chatting with Locra"
          />
        </Animated.View>
      }
    >
      <View style={styles.block}>
        <Animated.View style={[styles.iconWrap, iconStyle]}>
          <SetupStateIcon icon="check" tone="primary" halo />
        </Animated.View>

        <Animated.Text entering={textEntry(TITLE_DELAY_MS)} style={styles.title}>
          Locra is ready.
        </Animated.Text>
        <Animated.Text entering={textEntry(SUBTITLE_DELAY_MS)} style={styles.subtitle}>
          Your AI now runs on this device.
        </Animated.Text>
      </View>
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
  },
  iconWrap: {
    marginBottom: designTokens.spacing.space24,
  },
  title: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.screenTitle.fontSize,
    fontWeight: designTokens.type.screenTitle.fontWeight,
    lineHeight: designTokens.type.screenTitle.lineHeight,
    textAlign: 'center',
    marginBottom: designTokens.spacing.space12,
  },
  subtitle: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
    textAlign: 'center',
  },
});
