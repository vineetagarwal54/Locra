import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { theme } from '../constants/theme';

// Shown while the app reconciles the on-device model against disk at launch,
// before the navigator decides where to send the user. Static and dependency-free.

export function SplashScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.wordmark}>Locra</Text>
      <ActivityIndicator color={theme.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.canvas,
  },
  wordmark: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeXl,
    fontWeight: '700',
    marginBottom: theme.space5,
  },
});
