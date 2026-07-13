import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { designTokens, haptics } from '../../constants/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Shared onboarding / model-setup primitives (design.md §8 reusable components:
// PrimaryButton, SecondaryTextButton, SetupStateIcon, OnboardingLayout). Every
// value comes from `designTokens` so the flow stays in one warm/light visual
// language. No screen in this flow hardcodes competing colors, spacing, or radii.
// ─────────────────────────────────────────────────────────────────────────────

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

interface OnboardingScreenProps {
  children: ReactNode;
  footer?: ReactNode;
  /** Vertically center the scroll content (used by the sparse setup screens). */
  center?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

// Safe-area-aware, always-scrollable scaffold (design.md §5.1 / §10: onboarding
// becomes scrollable on short devices; footer actions stay reachable).
export function OnboardingScreen({
  children,
  footer,
  center = false,
  contentStyle,
}: OnboardingScreenProps) {
  return (
    <SafeAreaView style={styles.screenRoot} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          center && styles.scrollContentCentered,
          contentStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {footer !== undefined ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  /** `onDark` variant sits on the dark Welcome hero (design.md §7.1). */
  tone?: 'primary' | 'onDark';
}

// design.md §3.1 one dominant action; motion.md §9 press scale 1 → 0.985.
export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled = false,
  loading = false,
  accessibilityLabel,
  tone = 'primary',
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={() => {
        void haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.primaryButton,
        tone === 'onDark' && styles.primaryButtonOnDark,
        pressed && !isDisabled && styles.primaryButtonPressed,
        pressed && !isDisabled && tone === 'onDark' && styles.primaryButtonOnDarkPressed,
        isDisabled && styles.buttonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={designTokens.color.onPrimary} />
      ) : (
        <View style={styles.primaryButtonInner}>
          <Text style={styles.primaryLabel}>{label}</Text>
          {icon !== undefined ? (
            <MaterialCommunityIcons
              name={icon}
              size={designTokens.type.cardTitle.fontSize}
              color={designTokens.color.onPrimary}
              style={styles.primaryIcon}
            />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

interface SecondaryTextButtonProps {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}

// Quiet secondary action (design.md §3.1: secondary actions stay quieter).
export function SecondaryTextButton({
  label,
  onPress,
  accessibilityLabel,
  disabled = false,
}: SecondaryTextButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.secondaryButton,
        pressed && !disabled && styles.secondaryButtonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
  );
}

interface SetupStateIconProps {
  icon: IconName;
  shape?: 'circle' | 'rounded';
  tone?: 'neutral' | 'primary' | 'error';
  halo?: boolean;
}

const ICON_BADGE_SIZE = 64;

// design.md §8 SetupStateIcon: the circular / rounded icon badge used across the
// model-intro, download, success, and error setup states.
export function SetupStateIcon({
  icon,
  shape = 'circle',
  tone = 'neutral',
  halo = false,
}: SetupStateIconProps) {
  const badge = (
    <View
      style={[
        styles.iconBadge,
        shape === 'rounded' ? styles.iconBadgeRounded : styles.iconBadgeCircle,
        tone === 'primary' && styles.iconBadgePrimary,
        tone === 'error' && styles.iconBadgeError,
      ]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={designTokens.type.screenTitle.fontSize}
        color={
          tone === 'primary'
            ? designTokens.color.onPrimary
            : tone === 'error'
              ? designTokens.color.error
              : designTokens.color.textPrimary
        }
      />
    </View>
  );

  if (!halo) {
    return badge;
  }
  return <View style={styles.iconHalo}>{badge}</View>;
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    backgroundColor: designTokens.color.canvas,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: designTokens.spacing.space20,
    paddingTop: designTokens.spacing.space24,
    paddingBottom: designTokens.spacing.space24,
  },
  scrollContentCentered: {
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: designTokens.spacing.space20,
    paddingTop: designTokens.spacing.space12,
    paddingBottom: designTokens.spacing.space16,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: designTokens.spacing.space16,
    paddingHorizontal: designTokens.spacing.space24,
    borderRadius: designTokens.radius.buttonPrimary,
    backgroundColor: designTokens.color.primary,
  },
  primaryButtonOnDark: {
    backgroundColor: designTokens.color.primarySoft,
  },
  primaryButtonPressed: {
    backgroundColor: designTokens.color.primarySoft,
    transform: [{ scale: 0.985 }],
  },
  primaryButtonOnDarkPressed: {
    backgroundColor: designTokens.color.primary,
  },
  primaryButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryIcon: {
    marginLeft: designTokens.spacing.space8,
  },
  primaryLabel: {
    color: designTokens.color.onPrimary,
    fontSize: designTokens.type.button.fontSize,
    fontWeight: designTokens.type.button.fontWeight,
  },
  secondaryButton: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: designTokens.spacing.space24 * 2,
    paddingVertical: designTokens.spacing.space12,
    paddingHorizontal: designTokens.spacing.space24,
  },
  secondaryButtonPressed: {
    opacity: 0.6,
  },
  secondaryLabel: {
    color: designTokens.color.primary,
    fontSize: designTokens.type.button.fontSize,
    fontWeight: designTokens.type.button.fontWeight,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  iconBadge: {
    width: ICON_BADGE_SIZE,
    height: ICON_BADGE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.surfaceStrong,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  iconBadgeCircle: {
    borderRadius: designTokens.radius.pill,
  },
  iconBadgeRounded: {
    borderRadius: designTokens.radius.card,
  },
  iconBadgePrimary: {
    backgroundColor: designTokens.color.primary,
    borderColor: designTokens.color.primary,
  },
  iconBadgeError: {
    backgroundColor: designTokens.color.errorSurface,
    borderColor: designTokens.color.errorSurface,
  },
  iconHalo: {
    width: ICON_BADGE_SIZE + designTokens.spacing.space20,
    height: ICON_BADGE_SIZE + designTokens.spacing.space20,
    borderRadius: designTokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.surface,
  },
});
