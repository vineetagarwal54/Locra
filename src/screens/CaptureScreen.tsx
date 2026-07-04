import { StyleSheet, Text, View } from 'react-native';

export function CaptureScreen() {
  return (
    <View style={styles.container}>
      <Text>Capture</Text>
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
