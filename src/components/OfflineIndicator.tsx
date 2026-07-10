import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { designTokens } from '../constants/theme';

// Always-visible reassurance that inference is on-device (constitution Principle I,
// FR-004). Mounted in both the Capture and Answer headers.

export function OfflineIndicator(): ReactElement {
  return (
    <View style={styles.pill} accessibilityLabel="On-device inference indicator" accessible>
      <MaterialCommunityIcons
        name="shield-check"
        size={designTokens.type.body.fontSize}
        color={designTokens.color.primary}
      />
      <Text style={styles.label}>On-device</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: designTokens.spacing.space4,
    paddingHorizontal: designTokens.spacing.space12,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  label: {
    color: designTokens.color.primary,
    fontSize: designTokens.type.caption.fontSize,
    fontWeight: designTokens.type.caption.fontWeight,
    marginLeft: designTokens.spacing.space8,
  },
});
