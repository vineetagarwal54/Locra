import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
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
  SecondaryTextButton,
  SetupStateIcon,
} from '../components/onboarding/OnboardingKit';
import { designTokens, haptics } from '../constants/theme';
import { formatGigabytes } from '../model/ModelPresentation';
import { getStorageAvailability, type StorageAvailability } from '../model/StorageCheck';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'InsufficientStorage'>;

// motion.md §8 — error icon settles once; §16 uses a light error haptic when a
// recovery action still cannot proceed.
const ICON_SETTLE_MS = 300;
const TEXT_DURATION_MS = 240;
const TITLE_DELAY_MS = 60;
const BODY_DELAY_MS = 120;
const CARD_DELAY_MS = 180;

function bytesLabel(bytes: number | null): string {
  return bytes === null ? 'Unknown' : formatGigabytes(bytes);
}

export function InsufficientStorageScreen({ navigation }: Props) {
  const reduceMotion = useReducedMotion();
  const [availability, setAvailability] = useState<StorageAvailability | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let active = true;
    void getStorageAvailability().then((result) => {
      if (active) {
        setAvailability(result);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const iconScale = useSharedValue(reduceMotion ? 1 : 0.94);
  useEffect(() => {
    iconScale.value = reduceMotion ? 1 : withTiming(1, { duration: ICON_SETTLE_MS });
  }, [iconScale, reduceMotion]);
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  // Retry MUST re-check real free space before continuing (design.md §7.7).
  const onRetry = useCallback(async (): Promise<void> => {
    setChecking(true);
    const next = await getStorageAvailability();
    setAvailability(next);
    if (next.sufficient) {
      // Return to the download step. DownloadProgress only (re)starts when the
      // model is not_started/failed and the manager guards against concurrent
      // runs, so this never duplicates an in-flight download.
      navigation.replace('DownloadProgress', { autoStart: true });
      return;
    }
    setChecking(false);
    void haptics.error();
  }, [navigation]);

  // Manage Storage opens the Android storage/settings surface (design.md §7.7).
  const onManageStorage = useCallback(async (): Promise<void> => {
    try {
      if (Platform.OS === 'android') {
        await Linking.sendIntent('android.settings.INTERNAL_STORAGE_SETTINGS');
        return;
      }
      await Linking.openSettings();
    } catch {
      // Fall back to the app settings surface if the storage intent is refused.
      try {
        await Linking.openSettings();
      } catch {
        // Nothing more we can do; the screen still lets the user retry.
      }
    }
  }, []);

  const requiredLabel = bytesLabel(availability?.requiredBytes ?? null);
  const availableLabel = bytesLabel(availability?.availableBytes ?? null);
  const shortfallLabel = bytesLabel(
    availability && availability.availableBytes !== null ? availability.shortfallBytes : null
  );

  const stats: { label: string; value: string; emphasize?: boolean }[] = [
    { label: 'Storage required', value: requiredLabel },
    { label: 'Available now', value: availableLabel },
    { label: 'Free up at least', value: shortfallLabel, emphasize: true },
  ];

  return (
    <OnboardingScreen
      center
      footer={
        <View>
          <PrimaryButton
            label={checking ? 'Checking…' : 'Retry'}
            loading={checking}
            onPress={() => {
              void onRetry();
            }}
            accessibilityLabel="Re-check available storage and retry"
          />
          <SecondaryTextButton
            label="Manage storage"
            onPress={() => {
              void onManageStorage();
            }}
            accessibilityLabel="Open device storage settings"
          />
        </View>
      }
    >
      <View style={styles.block}>
        <Animated.View style={[styles.iconWrap, iconStyle]}>
          <SetupStateIcon icon="harddisk" shape="rounded" tone="error" />
        </Animated.View>

        {/* design.md §11 — errors read as icon + title + message, not color alone. */}
        <Animated.Text
          entering={reduceMotion ? undefined : FadeInDown.duration(TEXT_DURATION_MS).delay(TITLE_DELAY_MS)}
          style={styles.title}
        >
          Insufficient Storage
        </Animated.Text>
        <Animated.Text
          entering={reduceMotion ? undefined : FadeInDown.duration(TEXT_DURATION_MS).delay(BODY_DELAY_MS)}
          style={styles.body}
        >
          Locra needs about {requiredLabel} free to install the AI model on this device. Free up some
          space, then try again.
        </Animated.Text>

        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(TEXT_DURATION_MS).delay(CARD_DELAY_MS)}
          style={styles.statCard}
        >
          {stats.map((stat, index) => (
            <View
              key={stat.label}
              style={[styles.statRow, index < stats.length - 1 && styles.statRowDivider]}
            >
              <Text style={styles.statLabel}>{stat.label}</Text>
              <Text style={[styles.statValue, stat.emphasize && styles.statValueEmphasis]}>
                {stat.value}
              </Text>
            </View>
          ))}
        </Animated.View>
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
  body: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
    textAlign: 'center',
    marginBottom: designTokens.spacing.space24,
  },
  statCard: {
    alignSelf: 'stretch',
    backgroundColor: designTokens.color.surface,
    borderRadius: designTokens.radius.card,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    paddingHorizontal: designTokens.spacing.space16,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: designTokens.spacing.space12,
  },
  statRowDivider: {
    borderBottomWidth: designTokens.borderWidth,
    borderBottomColor: designTokens.color.divider,
  },
  statLabel: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
  },
  statValue: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.supporting.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    fontVariant: ['tabular-nums'],
  },
  statValueEmphasis: {
    color: designTokens.color.error,
  },
});
