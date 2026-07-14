import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { designTokens, haptics } from '../../constants/theme';
import { RESPONSE_MODES, type ResponseMode } from '../../inference/ResponseMode';
import { LocraSheet } from '../LocraSheet';

interface ResponseModeSelectorProps {
  readonly value: ResponseMode;
  readonly disabled?: boolean;
  readonly onChange: (mode: ResponseMode) => void;
}

const MODE_DESCRIPTION: Readonly<Record<ResponseMode, string>> = {
  Low: 'Quick',
  Medium: 'Balanced',
  High: 'Detailed',
};

export function ResponseModeSelector({ value, disabled = false, onChange }: ResponseModeSelectorProps) {
  const [sheetVisible, setSheetVisible] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Response depth: ${value}. Tap to change.`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        style={({ pressed }) => [
          styles.pill,
          pressed && !disabled && styles.pillPressed,
          disabled && styles.disabled,
        ]}
        onPress={() => {
          void haptics.tap();
          setSheetVisible(true);
        }}
      >
        <Text style={styles.pillLabel}>{value}</Text>
        <MaterialCommunityIcons
          name="chevron-down"
          size={16}
          color={designTokens.color.textSecondary}
        />
      </Pressable>

      <LocraSheet
        visible={sheetVisible}
        title="Response depth"
        message="Applies to this conversation's future replies."
        onRequestClose={() => setSheetVisible(false)}
      >
        <View style={styles.optionList}>
          {RESPONSE_MODES.map((mode) => {
            const selected = mode === value;
            return (
              <Pressable
                key={mode}
                accessibilityRole="radio"
                accessibilityLabel={`${mode} response depth`}
                accessibilityState={{ checked: selected }}
                style={({ pressed }) => [
                  styles.option,
                  selected && styles.optionSelected,
                  pressed && styles.optionPressed,
                ]}
                onPress={() => {
                  void haptics.tap();
                  onChange(mode);
                  setSheetVisible(false);
                }}
              >
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>{mode}</Text>
                  <Text style={styles.optionDescription}>{MODE_DESCRIPTION[mode]}</Text>
                </View>
                {selected ? (
                  <MaterialCommunityIcons
                    name="check"
                    size={20}
                    color={designTokens.color.primary}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </LocraSheet>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.spacing.space4,
    minHeight: designTokens.spacing.space24 + designTokens.spacing.space16,
    paddingVertical: designTokens.spacing.space4,
    paddingLeft: designTokens.spacing.space16,
    paddingRight: designTokens.spacing.space12,
    borderRadius: designTokens.radius.pill,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    backgroundColor: designTokens.color.surface,
  },
  pillPressed: {
    backgroundColor: designTokens.color.divider,
  },
  pillLabel: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.supporting.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
  },
  disabled: {
    opacity: 0.45,
  },
  optionList: {
    marginTop: designTokens.spacing.space8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: designTokens.spacing.space24 * 2,
    paddingHorizontal: designTokens.spacing.space16,
    paddingVertical: designTokens.spacing.space12,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginBottom: designTokens.spacing.space8,
  },
  optionSelected: {
    borderColor: designTokens.color.primary,
  },
  optionPressed: {
    backgroundColor: designTokens.color.divider,
  },
  optionText: {
    flex: 1,
    paddingRight: designTokens.spacing.space12,
  },
  optionTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.cardTitle.fontSize,
    fontWeight: designTokens.type.cardTitle.fontWeight,
  },
  optionDescription: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    marginTop: designTokens.spacing.space4,
  },
});
