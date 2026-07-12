import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useReducedMotion } from 'react-native-reanimated';

import {
  OnboardingScreen,
  PrimaryButton,
  SetupStateIcon,
} from '../components/onboarding/OnboardingKit';
import { designTokens } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Privacy'>;
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

interface Benefit {
  icon: IconName;
  title: string;
  detail: string;
}

// design.md §7.2 benefit rows — plain-language local-first value.
const BENEFITS: Benefit[] = [
  {
    icon: 'wifi-off',
    title: 'Works without internet',
    detail: 'No connection required for core AI tasks.',
  },
  {
    icon: 'cellphone-lock',
    title: 'Stay on your device',
    detail: 'Conversations and images never leave your hardware.',
  },
  {
    icon: 'flash-outline',
    title: 'Fast local responses',
    detail: 'No network latency, just instant AI assistance.',
  },
];

// motion.md §7.2 — icon, title, then benefit rows with a 40–50 ms stagger.
const ROW_STAGGER_MS = 45;
const ROW_BASE_DELAY_MS = 120;
const ROW_DURATION_MS = 240;

export function PrivacyScreen({ navigation }: Props) {
  const reduceMotion = useReducedMotion();

  const onContinue = useCallback((): void => {
    navigation.replace('ModelSelection');
  }, [navigation]);

  return (
    <OnboardingScreen
      footer={
        <PrimaryButton
          label="Continue"
          onPress={onContinue}
          accessibilityLabel="Continue to model setup"
        />
      }
    >
      <View style={styles.iconWrap}>
        <SetupStateIcon icon="shield-check-outline" shape="rounded" tone="neutral" />
      </View>

      <Text style={styles.title}>Intelligence that respects your privacy.</Text>

      <View style={styles.benefitList}>
        {BENEFITS.map((benefit, index) => {
          const entering = reduceMotion
            ? undefined
            : FadeInDown.duration(ROW_DURATION_MS).delay(ROW_BASE_DELAY_MS + index * ROW_STAGGER_MS);
          return (
            <Animated.View key={benefit.title} entering={entering} style={styles.benefitRow}>
              <View style={styles.benefitIcon}>
                <MaterialCommunityIcons
                  name={benefit.icon}
                  size={designTokens.type.sectionTitle.fontSize}
                  color={designTokens.color.primary}
                />
              </View>
              <View style={styles.benefitBody}>
                <Text style={styles.benefitTitle}>{benefit.title}</Text>
                <Text style={styles.benefitDetail}>{benefit.detail}</Text>
              </View>
            </Animated.View>
          );
        })}
      </View>
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    marginTop: designTokens.spacing.space16,
    marginBottom: designTokens.spacing.space24,
  },
  title: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.screenTitle.fontSize,
    fontWeight: designTokens.type.screenTitle.fontWeight,
    lineHeight: designTokens.type.screenTitle.lineHeight,
    marginBottom: designTokens.spacing.space32,
  },
  benefitList: {
    marginBottom: designTokens.spacing.space16,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: designTokens.spacing.space24,
  },
  benefitIcon: {
    width: designTokens.spacing.space40,
    height: designTokens.spacing.space40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginRight: designTokens.spacing.space16,
  },
  benefitBody: {
    flex: 1,
    paddingTop: designTokens.spacing.space4,
  },
  benefitTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.bodyStrong.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    marginBottom: designTokens.spacing.space4,
  },
  benefitDetail: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
  },
});
