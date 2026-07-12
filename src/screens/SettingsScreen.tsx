import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { designTokens, haptics } from '../constants/theme';
import { RESPONSE_MODES, type ResponseMode } from '../inference/ResponseMode';
import { QWEN_V1_DESCRIPTOR } from '../model/ActiveModel';
import { createQwenModelPresentation } from '../model/ModelPresentation';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useSettingsStore } from '../store/settingsStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const responseMode = useSettingsStore((state) => state.responseMode);
  const setResponseMode = useSettingsStore((state) => state.setResponseMode);
  const presentation = createQwenModelPresentation();

  const onBack = useCallback((): void => {
    void haptics.tap();
    navigation.goBack();
  }, [navigation]);

  const onSelectMode = useCallback((mode: ResponseMode): void => {
    void haptics.tap();
    setResponseMode(mode);
  }, [setResponseMode]);

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
            <Text style={styles.modelName}>{QWEN_V1_DESCRIPTOR.displayName}</Text>
            <Text style={styles.modelMeta}>{presentation.downloadSizeLabel} downloaded model</Text>
          </View>
        </View>
        <Text style={[styles.sectionLabel, styles.responseLabel]}>RESPONSE DETAIL</Text>
        <View style={styles.modeRow}>
          {RESPONSE_MODES.map((mode) => {
            const selected = mode === responseMode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityLabel={`${mode} response detail`}
                accessibilityState={{ selected }}
                onPress={() => onSelectMode(mode)}
                style={[styles.modeButton, selected && styles.modeButtonSelected]}
              >
                <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{mode}</Text>
              </Pressable>
            );
          })}
        </View>
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
  responseLabel: { marginTop: designTokens.spacing.space32 },
  modeRow: { flexDirection: 'row', gap: designTokens.spacing.space8 },
  modeButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: designTokens.borderWidth, borderColor: designTokens.color.border, borderRadius: designTokens.radius.card, backgroundColor: designTokens.color.surfaceStrong },
  modeButtonSelected: { borderColor: designTokens.color.primary, backgroundColor: designTokens.color.surface },
  modeText: { color: designTokens.color.textSecondary, fontSize: designTokens.type.button.fontSize, fontWeight: designTokens.type.button.fontWeight },
  modeTextSelected: { color: designTokens.color.primary },
});
