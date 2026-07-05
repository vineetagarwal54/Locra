import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { haptics, theme } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useModelStore } from '../store/modelStore';

type Props = NativeStackScreenProps<RootStackParamList, 'ModelSetup'>;

export function ModelSetupScreen({ navigation }: Props) {
  const downloadStatus = useModelStore((s) => s.downloadStatus);
  const downloadProgress = useModelStore((s) => s.downloadProgress);
  const integrityVerified = useModelStore((s) => s.integrityVerified);
  const error = useModelStore((s) => s.error);

  const checkDeviceCompatibility = useModelStore((s) => s.checkDeviceCompatibility);
  const startDownload = useModelStore((s) => s.startDownload);
  const pauseDownload = useModelStore((s) => s.pauseDownload);
  const resumeDownload = useModelStore((s) => s.resumeDownload);
  const cancelDownload = useModelStore((s) => s.cancelDownload);

  // Constitution Principle IV: compatibility is checked before any model load.
  const compatibility = useMemo(() => checkDeviceCompatibility(), [checkDeviceCompatibility]);

  const isReady = downloadStatus === 'downloaded' && integrityVerified;

  // Once the model is downloaded and verified, move on to the camera.
  useEffect(() => {
    if (isReady) {
      navigation.replace('Capture');
    }
  }, [isReady, navigation]);

  const onStart = (): void => {
    void haptics.tap();
    void startDownload();
  };
  const onPause = (): void => {
    void haptics.tap();
    void pauseDownload();
  };
  const onResume = (): void => {
    void haptics.tap();
    void resumeDownload();
  };
  const onCancel = (): void => {
    void haptics.tap();
    void cancelDownload();
  };

  if (!compatibility.isSupported) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.glyph}>📵</Text>
          <Text style={styles.title}>This phone can’t run Locra</Text>
          <Text style={styles.body}>
            {compatibility.reason ?? 'This device does not meet the requirements to run Locra.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const progressPercent = Math.round(downloadProgress * 100);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.centered}>
        <Text style={styles.glyph}>⬇️</Text>
        <Text style={styles.title}>Get Locra ready</Text>
        <Text style={styles.body}>
          Locra needs to download its vision model once. It stays on your phone afterwards, and
          everything works without the internet from then on.
        </Text>

        {downloadStatus === 'downloading' || downloadStatus === 'paused' ? (
          <View style={styles.progressBlock}>
            <View style={styles.progressTrack}>
              {/* eslint-disable-next-line react-native/no-inline-styles */}
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
            <Text style={styles.progressLabel}>{progressPercent}%</Text>
          </View>
        ) : null}

        {error !== null && downloadStatus === 'failed' ? (
          <Text style={styles.error}>{error}</Text>
        ) : null}
      </View>

      <View style={styles.footer}>
        {downloadStatus === 'downloading' ? (
          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Pause the download"
              style={styles.secondaryButton}
              onPress={onPause}
            >
              <Text style={styles.secondaryLabel}>Pause</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel the download"
              style={styles.ghostButton}
              onPress={onCancel}
            >
              <Text style={styles.ghostLabel}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}

        {downloadStatus === 'paused' ? (
          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resume the download"
              style={styles.primaryButton}
              onPress={onResume}
            >
              <Text style={styles.primaryLabel}>Resume</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel the download"
              style={styles.ghostButton}
              onPress={onCancel}
            >
              <Text style={styles.ghostLabel}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}

        {downloadStatus === 'not_started' || downloadStatus === 'failed' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={downloadStatus === 'failed' ? 'Try the download again' : 'Download the model'}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            onPress={onStart}
          >
            <Text style={styles.primaryLabel}>
              {downloadStatus === 'failed' ? 'Try again' : 'Download model'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.canvas,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space5,
  },
  glyph: {
    fontSize: theme.fontSizeXl,
    marginBottom: theme.space4,
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: theme.space3,
  },
  body: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
    textAlign: 'center',
    marginBottom: theme.space5,
  },
  progressBlock: {
    width: '100%',
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: theme.space2,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
  },
  progressLabel: {
    marginTop: theme.space2,
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    fontVariant: ['tabular-nums'],
  },
  error: {
    marginTop: theme.space4,
    color: theme.error,
    fontSize: theme.fontSizeSm,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: theme.space5,
    paddingBottom: theme.space4,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  primaryButton: {
    flex: 1,
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
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.space4,
    marginRight: theme.space3,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
  },
  secondaryLabel: {
    color: theme.accent,
    fontSize: theme.fontSizeMd,
    fontWeight: '600',
  },
  ghostButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.space4,
    borderRadius: theme.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
  },
  ghostLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
    fontWeight: '600',
  },
});
