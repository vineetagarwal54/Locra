import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  return (
    <KeyboardProvider>
      <SafeAreaProvider>
        <AppNavigator />
        {/*
          design.md §4.1 / §7 — the app now uses the warm/light visual system,
          so status-bar icons default to dark for contrast on light screens.
          The one dark surface (Welcome hero) flips them to light while focused.
        */}
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </KeyboardProvider>
  );
}
