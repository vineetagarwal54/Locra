import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  OnboardingScreen,
  PrimaryButton,
  SecondaryTextButton,
  SetupStateIcon,
} from '../components/onboarding/OnboardingKit';
import { designTokens } from '../constants/theme';
import { createQwenModelPresentation } from '../model/ModelPresentation';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useModelStore } from '../store/modelStore';

type Props = NativeStackScreenProps<RootStackParamList, 'ModelIntro'>;
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

interface MetadataRow {
  icon: IconName;
  label: string;
  value: string;
}

export function ModelIntroScreen({ navigation }: Props) {
  const presentation = createQwenModelPresentation();
  const checkDeviceCompatibility = useModelStore((s) => s.checkDeviceCompatibility);
  const compatibility = useMemo(() => checkDeviceCompatibility(), [checkDeviceCompatibility]);

  // design.md §7.3 dynamic metadata rule — bound to real model configuration.
  const metadata: MetadataRow[] = [
    { icon: 'cube-outline', label: 'Model', value: presentation.displayName },
    { icon: 'cloud-download-outline', label: 'Download Size', value: presentation.downloadSizeLabel },
    { icon: 'harddisk', label: 'Storage Required', value: presentation.storageRequiredLabel },
  ];

  const onDownload = useCallback((): void => {
    // Permission rationale is shown BEFORE any OS prompt (design.md §7.4).
    navigation.navigate('NotificationRationale');
  }, [navigation]);

  const onNotNow = useCallback((): void => {
    // "Not now" must not mark the model as ready (design.md §7.3). We simply
    // leave setup for the main experience; the launch/readiness gate keeps
    // routing an unverified model back into setup when inference is attempted.
    navigation.replace('Chat', { conversationId: 'new' });
  }, [navigation]);

  if (!compatibility.isSupported) {
    return (
      <OnboardingScreen center>
        <View style={styles.centerBlock}>
          <View style={styles.iconWrap}>
            <SetupStateIcon icon="cellphone-off" shape="rounded" tone="error" />
          </View>
          <Text style={styles.title}>This phone cannot run Locra yet</Text>
          <Text style={styles.body}>
            {compatibility.reason ??
              'This device does not meet the requirements to run the model on-device.'}
          </Text>
          <View style={styles.noteCard}>
            <Text style={styles.noteText}>
              Nothing is broken. Locra just needs a supported Android device before it can load the
              model safely.
            </Text>
          </View>
        </View>
      </OnboardingScreen>
    );
  }

  return (
    <OnboardingScreen
      footer={
        <View>
          <PrimaryButton
            label="Download model"
            icon="arrow-right"
            onPress={onDownload}
            accessibilityLabel="Download the model"
          />
          <SecondaryTextButton
            label="Not now"
            onPress={onNotNow}
            accessibilityLabel="Skip the download for now"
          />
        </View>
      }
    >
      <View style={styles.iconWrap}>
        <SetupStateIcon icon="tray-arrow-down" shape="rounded" tone="neutral" />
      </View>

      <Text style={styles.title}>Your AI lives on your device.</Text>
      <Text style={styles.body}>
        Locra needs to download the AI model once. After that, the core experience works entirely
        offline.
      </Text>

      <View style={styles.metadataCard}>
        {metadata.map((row) => (
          <View key={row.label} style={styles.metadataRow}>
            <MaterialCommunityIcons
              name={row.icon}
              size={designTokens.type.body.fontSize}
              color={designTokens.color.textSecondary}
            />
            <Text style={styles.metadataLabel}>{row.label}</Text>
            <Text style={styles.metadataValue}>{row.value}</Text>
          </View>
        ))}

        <View style={styles.wifiRow}>
          <MaterialCommunityIcons
            name="wifi"
            size={designTokens.type.body.fontSize}
            color={designTokens.color.textSecondary}
          />
          <Text style={styles.wifiText}>Wi-Fi is recommended for a stable and faster download.</Text>
        </View>
      </View>
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  centerBlock: {
    alignItems: 'center',
  },
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
  metadataCard: {
    backgroundColor: designTokens.color.surface,
    borderRadius: designTokens.radius.card,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    padding: designTokens.spacing.space16,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: designTokens.spacing.space16,
  },
  metadataLabel: {
    flex: 1,
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.supporting.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    marginLeft: designTokens.spacing.space12,
  },
  metadataValue: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    textAlign: 'right',
  },
  wifiRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: designTokens.spacing.space12,
    borderTopWidth: designTokens.borderWidth,
    borderTopColor: designTokens.color.divider,
  },
  wifiText: {
    flex: 1,
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
    marginLeft: designTokens.spacing.space12,
  },
  noteCard: {
    alignSelf: 'stretch',
    backgroundColor: designTokens.color.surface,
    borderRadius: designTokens.radius.card,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    padding: designTokens.spacing.space16,
    marginTop: designTokens.spacing.space8,
  },
  noteText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
    textAlign: 'center',
  },
});
