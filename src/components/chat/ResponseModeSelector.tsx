import { Pressable, StyleSheet, Text, View } from 'react-native';

import { designTokens, haptics } from '../../constants/theme';
import { RESPONSE_MODES, type ResponseMode } from '../../inference/ResponseMode';

interface ResponseModeSelectorProps {
  readonly value: ResponseMode;
  readonly disabled?: boolean;
  readonly onChange: (mode: ResponseMode) => void;
}

export function ResponseModeSelector({ value, disabled = false, onChange }: ResponseModeSelectorProps) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Response depth" style={styles.group}>
      {RESPONSE_MODES.map((mode) => {
        const selected = mode === value;
        return (
          <Pressable
            key={mode}
            accessibilityRole="radio"
            accessibilityLabel={`${mode} response depth`}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            style={({ pressed }) => [
              styles.option,
              selected && styles.optionSelected,
              pressed && !disabled && styles.optionPressed,
            ]}
            onPress={() => {
              void haptics.tap();
              onChange(mode);
            }}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{mode}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    padding: designTokens.spacing.space4,
    borderRadius: designTokens.radius.pill,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    backgroundColor: designTokens.color.surface,
    marginBottom: designTokens.spacing.space8,
  },
  option: {
    minHeight: designTokens.spacing.space24 + designTokens.spacing.space20,
    minWidth: designTokens.spacing.space24 * 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
    paddingHorizontal: designTokens.spacing.space12,
  },
  optionSelected: { backgroundColor: designTokens.color.primary },
  optionPressed: { backgroundColor: designTokens.color.divider },
  label: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
  },
  labelSelected: { color: designTokens.color.onPrimary },
});
