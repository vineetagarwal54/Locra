import { StyleSheet, Text, View } from 'react-native';

export function BenchmarkScreen() {
  return (
    <View style={styles.container}>
      <Text>Benchmark</Text>
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
