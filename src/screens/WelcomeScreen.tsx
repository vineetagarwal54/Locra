import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCameraPermission } from 'react-native-vision-camera';

import { haptics, theme } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { storage } from '../storage/mmkv';
import { useModelStore } from '../store/modelStore';

// First run only. The primary promise here is trust: plain words, no jargon, no
// "AI" — just what it does and the fact that nothing ever leaves the phone.
// AppNavigator gates this screen on the MMKV `hasSeenWelcome` flag set below.

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

const HERO_BADGE_SIZE = 104;
const HERO_GLYPH_SIZE = 52;
const READABLE_LINE_HEIGHT_RATIO = 1.5;

export function WelcomeScreen({ navigation }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [denied, setDenied] = useState(false);

  const proceed = useCallback((): void => {
    // Never show this screen again once the person has gotten started.
    storage.set('hasSeenWelcome', true);
    // Hand off to the model-download screen unless the model is already ready
    // (same gate AppNavigator uses at launch), otherwise straight to the camera.
    if (useModelStore.getState().isReadyForInference()) {
      navigation.replace('Capture');
    } else {
      navigation.replace('ModelSetup');
    }
  }, [navigation]);

  const onPrimary = useCallback(async (): Promise<void> => {
    void haptics.tap();
    if (hasPermission) {
      proceed();
      return;
    }
    const granted = await requestPermission();
    if (granted) {
      proceed();
    } else {
      setDenied(true);
    }
  }, [hasPermission, requestPermission, proceed]);

  const onOpenSettings = useCallback((): void => {
    void haptics.tap();
    void Linking.openSettings();
  }, []);

  const primaryLabel = hasPermission ? 'Get started' : 'Turn on camera';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroGlyph}>📷</Text>
        </View>

        <Text style={styles.headline}>Welcome to Locra</Text>
        <Text style={styles.subhead}>
          Point your camera at anything around you and ask a question about it. Locra will tell you
          what it sees.
        </Text>

        <View style={styles.privacyCard}>
          <Text style={styles.privacyGlyph}>🔒</Text>
          <View style={styles.privacyBody}>
            <Text style={styles.privacyTitle}>Everything stays on your phone</Text>
            <Text style={styles.privacyText}>
              Your pictures and your questions never leave this device. Nothing is sent to the
              internet, and nothing is ever shared. What you see is just for you.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {denied ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeText}>
              No problem — you can turn this on any time. Open your phone’s Settings, find Locra, and
              switch on Camera.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open your phone settings to allow the camera"
              style={styles.secondaryButton}
              onPress={onOpenSettings}
            >
              <Text style={styles.secondaryLabel}>Open Settings</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.permissionNote}>
            To get started, Locra needs your permission to use the camera.
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasPermission ? 'Get started' : 'Turn on the camera to begin'}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
          onPress={onPrimary}
        >
          <Text style={styles.primaryLabel}>{primaryLabel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.canvas,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.space5,
    paddingVertical: theme.space6,
  },
  hero: {
    width: HERO_BADGE_SIZE,
    height: HERO_BADGE_SIZE,
    borderRadius: theme.radiusPill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginBottom: theme.space5,
  },
  heroGlyph: {
    fontSize: HERO_GLYPH_SIZE,
  },
  headline: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeXl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: theme.space3,
  },
  subhead: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
    textAlign: 'center',
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
    marginBottom: theme.space6,
  },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: theme.surface,
    borderRadius: theme.radiusLg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: theme.space4,
  },
  privacyGlyph: {
    fontSize: theme.fontSizeXl,
    marginRight: theme.space3,
  },
  privacyBody: {
    flex: 1,
  },
  privacyTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '600',
    marginBottom: theme.space2,
  },
  privacyText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
  },
  footer: {
    paddingHorizontal: theme.space5,
    paddingTop: theme.space4,
    paddingBottom: theme.space4,
  },
  permissionNote: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    textAlign: 'center',
    marginBottom: theme.space4,
  },
  noticeCard: {
    backgroundColor: theme.surface2,
    borderRadius: theme.radiusMd,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    padding: theme.space4,
    marginBottom: theme.space4,
  },
  noticeText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
    marginBottom: theme.space3,
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: theme.space3,
    borderRadius: theme.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    backgroundColor: theme.accentGlow,
  },
  secondaryLabel: {
    color: theme.accent,
    fontSize: theme.fontSizeMd,
    fontWeight: '600',
  },
  primaryButton: {
    alignItems: 'center',
    paddingVertical: theme.space4,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
  },
  primaryButtonPressed: {
    backgroundColor: theme.accentDim,
  },
  primaryLabel: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
  },
});
