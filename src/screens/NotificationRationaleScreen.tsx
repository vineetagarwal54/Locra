import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useReducedMotion } from 'react-native-reanimated';

import {
  OnboardingScreen,
  PrimaryButton,
  SecondaryTextButton,
} from '../components/onboarding/OnboardingKit';
import { designTokens } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { requestDownloadNotificationPermission } from '../platform/NotificationPermission';

type Props = NativeStackScreenProps<RootStackParamList, 'NotificationRationale'>;

// motion.md §7.4 — notification preview slides down (-12 → 0) on entry.
const PREVIEW_DURATION_MS = 250;

export function NotificationRationaleScreen({ navigation }: Props) {
  const reduceMotion = useReducedMotion();
  const [requesting, setRequesting] = useState(false);

  const startDownloadFlow = useCallback((): void => {
    // Downloading itself begins on the progress screen (autoStart), so the
    // download/network-gate logic stays untouched here.
    navigation.replace('DownloadProgress', { autoStart: true });
  }, [navigation]);

  const onAllow = useCallback(async (): Promise<void> => {
    // design.md §7.4 — OS permission is requested only now, on this action.
    setRequesting(true);
    try {
      await requestDownloadNotificationPermission();
    } finally {
      setRequesting(false);
      startDownloadFlow();
    }
  }, [startDownloadFlow]);

  const onNotNow = useCallback((): void => {
    // "Not now" must not block the download (design.md §7.4).
    startDownloadFlow();
  }, [startDownloadFlow]);

  return (
    <OnboardingScreen
      footer={
        <View>
          <PrimaryButton
            label="Allow notifications"
            loading={requesting}
            onPress={() => {
              void onAllow();
            }}
            accessibilityLabel="Allow download notifications"
          />
          <SecondaryTextButton
            label="Not now"
            onPress={onNotNow}
            accessibilityLabel="Continue without notifications"
          />
        </View>
      }
    >
      <Animated.View
        entering={reduceMotion ? undefined : FadeInDown.duration(PREVIEW_DURATION_MS)}
        style={styles.previewCard}
      >
        <View style={styles.previewHeader}>
          <View style={styles.previewBrand}>
            <View style={styles.previewGlyph}>
              <MaterialCommunityIcons
                name="shield-check"
                size={designTokens.type.supporting.fontSize}
                color={designTokens.color.onPrimary}
              />
            </View>
            <Text style={styles.previewBrandText}>LOCRA</Text>
          </View>
          <Text style={styles.previewTime}>now</Text>
        </View>
        <Text style={styles.previewTitle}>Downloading Local AI Model…</Text>
        <View style={styles.previewTrack}>
          <View style={styles.previewFill} />
        </View>
        <View style={styles.previewFooter}>
          <Text style={styles.previewMeta}>45% • 2 mins left</Text>
          <MaterialCommunityIcons
            name="tray-arrow-down"
            size={designTokens.type.supporting.fontSize}
            color={designTokens.color.textSecondary}
          />
        </View>
      </Animated.View>

      <Text style={styles.title}>Keep track of the download</Text>
      <Text style={styles.body}>
        Locra downloads a large AI model in the background. Notifications let you see download
        progress and know when the download is complete and ready for final verification.
      </Text>
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  previewCard: {
    backgroundColor: designTokens.color.surfaceStrong,
    borderRadius: designTokens.radius.card,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    padding: designTokens.spacing.space16,
    marginTop: designTokens.spacing.space16,
    marginBottom: designTokens.spacing.space32,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: designTokens.spacing.space12,
  },
  previewBrand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewGlyph: {
    width: designTokens.spacing.space20,
    height: designTokens.spacing.space20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.primary,
    marginRight: designTokens.spacing.space8,
  },
  previewBrandText: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.caption.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    letterSpacing: 0.5,
  },
  previewTime: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
  },
  previewTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.supporting.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    marginBottom: designTokens.spacing.space12,
  },
  previewTrack: {
    height: designTokens.spacing.space4,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.divider,
    overflow: 'hidden',
  },
  previewFill: {
    width: '45%',
    height: '100%',
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.primary,
  },
  previewFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: designTokens.spacing.space8,
  },
  previewMeta: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
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
  },
});
