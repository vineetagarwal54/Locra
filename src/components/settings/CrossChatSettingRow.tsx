import { StyleSheet, Switch, Text, View } from 'react-native';

import { designTokens } from '../../constants/theme';

interface CrossChatSettingRowProps {
  readonly label: string;
  readonly detail: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
}

export function CrossChatSettingRow({
  label,
  detail,
  value,
  onValueChange,
}: CrossChatSettingRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: designTokens.color.border,
          true: designTokens.color.primarySoft,
        }}
        thumbColor={designTokens.color.surfaceStrong}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designTokens.spacing.space16,
    paddingVertical: designTokens.spacing.space8,
  },
  body: {
    flex: 1,
    marginRight: designTokens.spacing.space12,
  },
  label: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.cardTitle.fontSize,
    fontWeight: designTokens.type.cardTitle.fontWeight,
  },
  detail: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
    marginTop: designTokens.spacing.space4,
  },
});
