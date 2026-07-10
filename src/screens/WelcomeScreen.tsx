import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCameraPermission } from 'react-native-vision-camera';

import { haptics, theme } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useModelStore } from '../store/modelStore';
import { useOnboardingStore } from '../store/onboardingStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

const HERO_CARD_WIDTH = 188;
const HERO_CARD_HEIGHT = 118;
const HERO_SIDE_CARD_WIDTH = 132;
const HERO_SIDE_CARD_HEIGHT = 92;
const LENS_SIZE = 58;
const LENS_INNER_SIZE = 30;
const READABLE_LINE_HEIGHT_RATIO = 1.5;

export function WelcomeScreen({ navigation }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const completeWelcome = useOnboardingStore((s) => s.completeWelcome);
  const isReadyForInference = useModelStore((s) => s.isReadyForInference);
  const [denied, setDenied] = useState(false);

  const proceed = useCallback((): void => {
    completeWelcome();
    if (isReadyForInference()) {
      navigation.replace('Chat', { conversationId: 'new' });
    } else {
      navigation.replace('ModelSetup');
    }
  }, [completeWelcome, isReadyForInference, navigation]);

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

  const primaryLabel = denied
    ? 'Try camera again'
    : hasPermission
      ? 'Start looking'
      : 'Allow camera';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroStack} accessibilityLabel="Locra photo cards" accessible>
          <View style={[styles.sidePhoto, styles.leftPhoto]}>
            <Text style={styles.photoKicker}>Plant</Text>
            <Text style={styles.photoText}>Is it healthy?</Text>
          </View>
          <View style={[styles.sidePhoto, styles.rightPhoto]}>
            <Text style={styles.photoKicker}>Tool</Text>
            <Text style={styles.photoText}>What is this for?</Text>
          </View>
          <View style={styles.mainPhoto}>
            <View style={styles.lens}>
              <View style={styles.lensInner} />
            </View>
            <Text style={styles.mainPhotoTitle}>Locra</Text>
            <Text style={styles.mainPhotoText}>snap, ask, understand</Text>
          </View>
        </View>

        <Text style={styles.headline}>A camera that answers back</Text>
        <Text style={styles.subhead}>
          Take a photo, ask in your own words, and Locra explains it right on your phone.
        </Text>

        <View style={styles.promiseGrid}>
          <View style={styles.promiseCard}>
            <Text style={styles.promiseNumber}>1</Text>
            <Text style={styles.promiseText}>Point at anything nearby.</Text>
          </View>
          <View style={styles.promiseCard}>
            <Text style={styles.promiseNumber}>2</Text>
            <Text style={styles.promiseText}>Ask the question you already have.</Text>
          </View>
          <View style={styles.promiseCard}>
            <Text style={styles.promiseNumber}>3</Text>
            <Text style={styles.promiseText}>Keep the photo and answer on this phone.</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {denied ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Camera is off for now</Text>
            <Text style={styles.noticeText}>
              You can turn it on in Settings whenever you are ready.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open phone settings to allow the camera"
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.secondaryButtonPressed,
              ]}
              onPress={onOpenSettings}
            >
              <Text style={styles.secondaryLabel}>Open Settings</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.permissionNote}>
            Locra needs camera access before the first photo.
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
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
    paddingTop: theme.space6,
    paddingBottom: theme.space4,
  },
  heroStack: {
    width: '100%',
    minHeight: HERO_CARD_HEIGHT + theme.space6,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.space6,
  },
  sidePhoto: {
    position: 'absolute',
    width: HERO_SIDE_CARD_WIDTH,
    height: HERO_SIDE_CARD_HEIGHT,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: theme.space3,
    justifyContent: 'flex-end',
  },
  leftPhoto: {
    left: theme.space2,
    top: theme.space5,
    transform: [{ rotate: '-8deg' }],
  },
  rightPhoto: {
    right: theme.space2,
    top: theme.space1,
    transform: [{ rotate: '7deg' }],
  },
  mainPhoto: {
    width: HERO_CARD_WIDTH,
    height: HERO_CARD_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
  },
  lens: {
    width: LENS_SIZE,
    height: LENS_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginBottom: theme.space3,
  },
  lensInner: {
    width: LENS_INNER_SIZE,
    height: LENS_INNER_SIZE,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
  },
  photoKicker: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    fontWeight: '700',
    marginBottom: theme.space1,
  },
  photoText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
  },
  mainPhotoTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
  },
  mainPhotoText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    marginTop: theme.space1,
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
    marginBottom: theme.space5,
  },
  promiseGrid: {
    width: '100%',
  },
  promiseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: theme.radiusLg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: theme.space4,
    marginBottom: theme.space3,
  },
  promiseNumber: {
    width: theme.space6,
    height: theme.space6,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    color: theme.accent,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: theme.space6,
    marginRight: theme.space3,
  },
  promiseText: {
    flex: 1,
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    lineHeight: theme.fontSizeSm * READABLE_LINE_HEIGHT_RATIO,
  },
  footer: {
    paddingHorizontal: theme.space5,
    paddingTop: theme.space3,
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
    borderRadius: theme.radiusLg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    padding: theme.space4,
    marginBottom: theme.space4,
  },
  noticeTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
    marginBottom: theme.space1,
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
  secondaryButtonPressed: {
    backgroundColor: theme.surface3,
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
