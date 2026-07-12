import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OnboardingScreen } from '../components/onboarding/OnboardingKit';
import { designTokens } from '../constants/theme';
import { MODEL_CANDIDATES, type ModelCandidate } from '../model/ActiveModel';
import { createModelPresentation } from '../model/ModelPresentation';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { selectModelForOnboarding } from '../store/modelSwitchCoordinator';

type Props = NativeStackScreenProps<RootStackParamList, 'ModelSelection'>;

export function ModelSelectionScreen({ navigation }: Props) {
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const onSelect = useCallback((model: ModelCandidate): void => {
    if (selectingId !== null) {
      return;
    }
    setSelectingId(model.id);
    void selectModelForOnboarding(model.id)
      .then((ready) => {
        navigation.replace(ready ? 'Success' : 'ModelIntro');
      })
      .catch(() => {
        setSelectingId(null);
      });
  }, [navigation, selectingId]);

  return (
    <OnboardingScreen>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name="cube-scan" size={32} color={designTokens.color.primary} />
      </View>
      <Text style={styles.title}>Choose your on-device model</Text>
      <Text style={styles.body}>You can change this later in Settings.</Text>
      <View style={styles.options}>
        {MODEL_CANDIDATES.map((model) => {
          const presentation = createModelPresentation(model);
          const disabled = selectingId !== null;
          return (
            <Pressable
              key={model.id}
              accessibilityRole="button"
              accessibilityLabel={`Select ${model.displayName}, ${presentation.downloadSizeLabel}`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => onSelect(model)}
              style={({ pressed }) => [
                styles.option,
                pressed && styles.optionPressed,
                disabled && selectingId !== model.id && styles.optionDisabled,
              ]}
            >
              <View style={styles.optionHeader}>
                <Text style={styles.optionTitle}>{model.displayName}</Text>
                <Text style={styles.optionSize}>{presentation.downloadSizeLabel}</Text>
              </View>
              <Text style={styles.optionBody}>{model.description}</Text>
              <View style={styles.optionAction}>
                <Text style={styles.optionActionText}>
                  {selectingId === model.id ? 'Preparing...' : 'Select model'}
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={designTokens.color.primary} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignItems: 'center', marginTop: designTokens.spacing.space16, marginBottom: designTokens.spacing.space24 },
  title: { color: designTokens.color.textPrimary, fontSize: designTokens.type.screenTitle.fontSize, fontWeight: designTokens.type.screenTitle.fontWeight, lineHeight: designTokens.type.screenTitle.lineHeight, textAlign: 'center', marginBottom: designTokens.spacing.space12 },
  body: { color: designTokens.color.textSecondary, fontSize: designTokens.type.body.fontSize, lineHeight: designTokens.type.body.lineHeight, textAlign: 'center', marginBottom: designTokens.spacing.space24 },
  options: { gap: designTokens.spacing.space12 },
  option: { backgroundColor: designTokens.color.surfaceStrong, borderWidth: designTokens.borderWidth, borderColor: designTokens.color.border, borderRadius: designTokens.radius.card, padding: designTokens.spacing.space16 },
  optionPressed: { backgroundColor: designTokens.color.surface },
  optionDisabled: { opacity: 0.55 },
  optionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: designTokens.spacing.space12 },
  optionTitle: { flex: 1, color: designTokens.color.textPrimary, fontSize: designTokens.type.cardTitle.fontSize, fontWeight: designTokens.type.cardTitle.fontWeight, lineHeight: designTokens.type.cardTitle.lineHeight },
  optionSize: { color: designTokens.color.textSecondary, fontSize: designTokens.type.supporting.fontSize, lineHeight: designTokens.type.supporting.lineHeight },
  optionBody: { color: designTokens.color.textSecondary, fontSize: designTokens.type.supporting.fontSize, lineHeight: designTokens.type.supporting.lineHeight, marginTop: designTokens.spacing.space8 },
  optionAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: designTokens.spacing.space12 },
  optionActionText: { color: designTokens.color.primary, fontSize: designTokens.type.button.fontSize, fontWeight: designTokens.type.button.fontWeight },
});
