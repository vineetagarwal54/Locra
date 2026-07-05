import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { theme } from '../constants/theme';

interface ReportButtonProps {
  disabled?: boolean;
  reported: boolean;
  onReport: () => void;
}

export function ReportButton({
  disabled = false,
  reported,
  onReport,
}: ReportButtonProps): ReactElement {
  const isDisabled = disabled || reported;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={reported ? 'Answer flagged' : 'Flag bad answer'}
      accessibilityState={{ disabled: isDisabled, selected: reported }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        reported && styles.buttonReported,
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && !reported && styles.buttonDisabled,
      ]}
      onPress={onReport}
    >
      <Text style={[styles.label, reported && styles.labelReported]}>
        {reported ? 'Flagged' : 'Flag answer'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    minHeight: theme.space6 * 2,
    justifyContent: 'center',
    paddingHorizontal: theme.space4,
    paddingVertical: theme.space2,
    borderRadius: theme.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    backgroundColor: theme.accentGlow,
  },
  buttonPressed: {
    backgroundColor: theme.surface3,
  },
  buttonReported: {
    borderColor: theme.success,
    backgroundColor: theme.surface2,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  label: {
    color: theme.accent,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
  },
  labelReported: {
    color: theme.success,
  },
});
