import { StyleSheet, Text, View } from 'react-native';

export function AnswerScreen() {
  return (
    <View style={styles.container}>
      <Text>Answer</Text>
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
