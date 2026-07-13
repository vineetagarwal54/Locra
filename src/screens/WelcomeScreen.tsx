import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/onboarding/OnboardingKit';
import { designTokens } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useOnboardingStore } from '../store/onboardingStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

// motion.md §7.1 — one-time entry: title, then subtitle, then CTA.
const SUBTITLE_DELAY_MS = 60;
const CTA_DELAY_MS = 120;
const ENTRY_DURATION_MS = 280;

export function WelcomeScreen({ navigation }: Props) {
  const completeWelcome = useOnboardingStore((s) => s.completeWelcome);
  const reduceMotion = useReducedMotion();

  // design.md §7.1 — Welcome is the one dark screen; give it light status-bar
  // icons while focused and restore dark icons (for the light flow) on blur.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, [])
  );

  const onContinue = useCallback((): void => {
    completeWelcome();
    navigation.replace('Privacy');
  }, [completeWelcome, navigation]);

  const entry = (delay: number) =>
    reduceMotion ? undefined : FadeInDown.duration(ENTRY_DURATION_MS).delay(delay);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* The open upper area is intentional (design.md §7.1). */}
      <View style={styles.spacer} />

      <View style={styles.hero}>
        <Animated.Text entering={entry(0)} style={styles.title}>
          AI that stays with you. Even offline.
        </Animated.Text>
        <Animated.Text entering={entry(SUBTITLE_DELAY_MS)} style={styles.subtitle}>
          Chat, understand images, and get help entirely on your device.
        </Animated.Text>
      </View>

      <Animated.View entering={entry(CTA_DELAY_MS)} style={styles.footer}>
        <PrimaryButton
          label="Continue"
          tone="onDark"
          onPress={onContinue}
          accessibilityLabel="Continue to privacy overview"
        />
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: designTokens.color.welcomeCanvas,
    paddingHorizontal: designTokens.spacing.space24,
  },
  spacer: {
    flex: 1,
  },
  hero: {
    marginBottom: designTokens.spacing.space32,
  },
  title: {
    color: designTokens.color.onPrimary,
    fontSize: designTokens.type.heroTitle.fontSize,
    fontWeight: designTokens.type.heroTitle.fontWeight,
    lineHeight: designTokens.type.heroTitle.lineHeight,
    textAlign: 'center',
    marginBottom: designTokens.spacing.space16,
  },
  subtitle: {
    color: designTokens.color.welcomeTextSecondary,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
    textAlign: 'center',
  },
  footer: {
    paddingBottom: designTokens.spacing.space16,
  },
});
