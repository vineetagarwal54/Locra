import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { designTokens, haptics } from '../constants/theme';
import { MODEL_CANDIDATES, getModelCandidate } from '../model/ActiveModel';
import { createModelPresentation } from '../model/ModelPresentation';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useModelSelectionStore } from '../store/modelSelectionStore';
import { requestModelSwitch } from '../store/modelSwitchCoordinator';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const selectedModelId = useModelSelectionStore((state) => state.selectedModelId);
  const developerOverrideId = useModelSelectionStore((state) => state.developerOverrideId);
  if (selectedModelId === null) {
    throw new Error('Settings requires a selected model.');
  }
  const selectedModel = getModelCandidate(selectedModelId);
  const alternative = MODEL_CANDIDATES.find((model) => model.id !== selectedModelId);
  if (alternative === undefined) {
    throw new Error('The alternative model descriptor is unavailable.');
  }
  const presentation = createModelPresentation(selectedModel);

  const onBack = useCallback((): void => {
    void haptics.tap();
    navigation.goBack();
  }, [navigation]);

  const onChangeModel = useCallback((): void => {
    Alert.alert(
      'Change model?',
      `Locra will unload ${selectedModel.displayName} and set up ${alternative.displayName}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change model',
          onPress: (): void => {
            const result = requestModelSwitch(alternative.id);
            if (!result.accepted) {
              Alert.alert('Cannot change model yet', result.reason);
            }
          },
        },
      ],
    );
  }, [alternative, selectedModel.displayName]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" style={styles.headerButton} onPress={onBack}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={designTokens.color.textSecondary} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.headerButton} />
      </View>
      <View style={styles.content}>
        <Text style={styles.sectionLabel}>ON-DEVICE MODEL</Text>
        <View style={styles.modelRow}>
          <View style={styles.modelIcon}>
            <MaterialCommunityIcons name="cube-outline" size={22} color={designTokens.color.primary} />
          </View>
          <View style={styles.modelBody}>
            <Text style={styles.modelName}>{selectedModel.displayName}</Text>
            <Text style={styles.modelMeta}>{presentation.downloadSizeLabel} downloaded model</Text>
          </View>
        </View>
        {developerOverrideId === null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change model to ${alternative.displayName}`}
            style={({ pressed }) => [styles.changeButton, pressed && styles.changeButtonPressed]}
            onPress={onChangeModel}
          >
            <MaterialCommunityIcons name="swap-horizontal" size={20} color={designTokens.color.primary} />
            <Text style={styles.changeButtonText}>Change model</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: designTokens.color.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: designTokens.spacing.space12, paddingVertical: designTokens.spacing.space12 },
  headerButton: { width: designTokens.spacing.space24 * 2, height: designTokens.spacing.space24 * 2, alignItems: 'center', justifyContent: 'center' },
  title: { color: designTokens.color.textPrimary, fontSize: designTokens.type.sectionTitle.fontSize, fontWeight: designTokens.type.sectionTitle.fontWeight },
  content: { paddingHorizontal: designTokens.spacing.space20, paddingTop: designTokens.spacing.space24 },
  sectionLabel: { color: designTokens.color.textSecondary, fontSize: designTokens.type.caption.fontSize, fontWeight: designTokens.type.caption.fontWeight, marginBottom: designTokens.spacing.space8 },
  modelRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: designTokens.color.surfaceStrong, borderWidth: designTokens.borderWidth, borderColor: designTokens.color.border, borderRadius: designTokens.radius.card, padding: designTokens.spacing.space16 },
  modelIcon: { width: designTokens.spacing.space40, height: designTokens.spacing.space40, alignItems: 'center', justifyContent: 'center', borderRadius: designTokens.radius.pill, backgroundColor: designTokens.color.surface, marginRight: designTokens.spacing.space12 },
  modelBody: { flex: 1 },
  modelName: { color: designTokens.color.textPrimary, fontSize: designTokens.type.cardTitle.fontSize, fontWeight: designTokens.type.cardTitle.fontWeight },
  modelMeta: { color: designTokens.color.textSecondary, fontSize: designTokens.type.supporting.fontSize, lineHeight: designTokens.type.supporting.lineHeight, marginTop: designTokens.spacing.space4 },
  changeButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: designTokens.spacing.space16, borderWidth: designTokens.borderWidth, borderColor: designTokens.color.border, borderRadius: designTokens.radius.card },
  changeButtonPressed: { backgroundColor: designTokens.color.surface },
  changeButtonText: { color: designTokens.color.primary, fontSize: designTokens.type.button.fontSize, fontWeight: designTokens.type.button.fontWeight, marginLeft: designTokens.spacing.space8 },
});
