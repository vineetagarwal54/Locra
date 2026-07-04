import { StyleSheet, Text, View } from 'react-native';

export function ModelSetupScreen() {
  return (
    <View style={styles.container}>
      <Text>Model Setup</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
