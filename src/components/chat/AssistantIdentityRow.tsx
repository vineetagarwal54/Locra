import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { designTokens } from '../../constants/theme';

interface AssistantIdentityRowProps {
  label?: string;
}

export function AssistantIdentityRow({
  label = 'Locra Vision Model',
}: AssistantIdentityRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons
          name="shield-check-outline"
          size={16}
          color={designTokens.color.primary}
        />
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: designTokens.spacing.space4,
  },
  iconWrap: {
    width: designTokens.spacing.space20,
    height: designTokens.spacing.space20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.circular,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginRight: designTokens.spacing.space4,
  },
  label: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    lineHeight: designTokens.type.supporting.lineHeight,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
  },
});
