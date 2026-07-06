import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../constants/theme';

// Always-visible reassurance that inference is on-device (constitution Principle I,
// FR-004). Mounted in both the Capture and Answer headers.

export function OfflineIndicator(): ReactElement {
  return (
    <View style={styles.pill} accessibilityLabel="On-device inference indicator" accessible>
      <MaterialCommunityIcons name="shield-check" size={theme.fontSizeMd} color={theme.accent} />
      <Text style={styles.label}>On-device</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.space1,
    paddingHorizontal: theme.space3,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
  },
  label: {
    color: theme.accent,
    fontSize: theme.fontSizeXs,
    fontWeight: '600',
    marginLeft: theme.space2,
  },
});
