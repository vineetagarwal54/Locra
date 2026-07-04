import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { withErrorBoundary } from '../components/ErrorBoundary';
import { AnswerScreen } from '../screens/AnswerScreen';
import { BenchmarkScreen } from '../screens/BenchmarkScreen';
import { CaptureScreen } from '../screens/CaptureScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { ModelSetupScreen } from '../screens/ModelSetupScreen';

export type RootStackParamList = {
  Capture: undefined;
  Answer: { imagePath: string; question: string };
  History: undefined;
  ModelSetup: undefined;
  Benchmark: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Constitution Principle III: every screen is wrapped so a render crash in one
// degrades to a legible fallback instead of taking down the app.
const Capture = withErrorBoundary(CaptureScreen);
const Answer = withErrorBoundary(AnswerScreen);
const History = withErrorBoundary(HistoryScreen);
const ModelSetup = withErrorBoundary(ModelSetupScreen);
const Benchmark = withErrorBoundary(BenchmarkScreen);

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Capture" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Capture" component={Capture} />
        <Stack.Screen name="Answer" component={Answer} />
        <Stack.Screen name="History" component={History} />
        <Stack.Screen name="ModelSetup" component={ModelSetup} />
        <Stack.Screen name="Benchmark" component={Benchmark} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
