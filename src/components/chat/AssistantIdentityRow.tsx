import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../constants/theme';

interface AssistantIdentityRowProps {
  label?: string;
}

export function AssistantIdentityRow({
  label = 'Locra Vision Model',
}: AssistantIdentityRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name="shield-check-outline" size={16} color={theme.accent} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.space2,
  },
  iconWrap: {
    width: theme.space6,
    height: theme.space6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginRight: theme.space2,
  },
  label: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    fontWeight: '600',
  },
});
