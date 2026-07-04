import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AnswerScreen } from '../screens/AnswerScreen';
import { BenchmarkScreen } from '../screens/BenchmarkScreen';
import { CaptureScreen } from '../screens/CaptureScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { ModelSetupScreen } from '../screens/ModelSetupScreen';

export type RootStackParamList = {
  Capture: undefined;
  Answer: undefined;
  History: undefined;
  ModelSetup: undefined;
  Benchmark: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Capture">
        <Stack.Screen name="Capture" component={CaptureScreen} />
        <Stack.Screen name="Answer" component={AnswerScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="ModelSetup" component={ModelSetupScreen} />
        <Stack.Screen name="Benchmark" component={BenchmarkScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
