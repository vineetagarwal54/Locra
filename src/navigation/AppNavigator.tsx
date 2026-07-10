import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';

import { ErrorBoundary, withErrorBoundary } from '../components/ErrorBoundary';
import { InferenceEngineHost } from '../components/InferenceEngineHost';
import { SplashScreen } from '../components/SplashScreen';
import { VoiceTranscriptionHost } from '../components/VoiceTranscriptionHost';
import { BenchmarkScreen } from '../screens/BenchmarkScreen';
import { CaptureScreen } from '../screens/CaptureScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { ModelSetupScreen } from '../screens/ModelSetupScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { useModelStore } from '../store/modelStore';
import { hasCompletedWelcome } from '../store/onboardingStore';
import { useVoiceStore } from '../store/voiceStore';

export type RootStackParamList = {
  Welcome: undefined;
  Chat: { conversationId: string };
  Capture: { conversationId: string };
  History: undefined;
  ModelSetup: undefined;
  Benchmark: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Constitution Principle III: every screen is wrapped so a render crash in one
// degrades to a legible fallback instead of taking down the app.
const Welcome = withErrorBoundary(WelcomeScreen);
const Chat = withErrorBoundary(ChatScreen);
const Capture = withErrorBoundary(CaptureScreen);
const History = withErrorBoundary(HistoryScreen);
const ModelSetup = withErrorBoundary(ModelSetupScreen);
const Benchmark = withErrorBoundary(BenchmarkScreen);

// Launch gate, checked in order (per the onboarding flow):
//   1. Never onboarded        → Welcome (explains the app + requests camera)
//   2. Onboarded, model not ready → ModelSetup (download / re-download)
//   3. Onboarded, model ready → Capture
// Returning users with a ready model land straight on New Chat.
function resolveInitialRoute(): keyof RootStackParamList {
  if (!hasCompletedWelcome()) {
    return 'Welcome';
  }
  if (!useModelStore.getState().isReadyForInference()) {
    return 'ModelSetup';
  }
  return 'Chat';
}

export function AppNavigator() {
  const engineReady = useModelStore(
    (s) => s.downloadStatus === 'downloaded' && s.integrityVerified
  );
  const [engineHostMounted, setEngineHostMounted] = useState(false);
  // FR-033: the voice host mounts lazily, only once the user activates voice, so
  // the Whisper model is never downloaded for users who never dictate.
  const voiceEnabled = useVoiceStore((s) => s.enabled);

  // Reattach native background downloads before filesystem reconciliation, so
  // an in-progress model download survives process death and routes to setup.
  // resolveInitialRoute() reads a synchronous snapshot, so it must run only
  // after bootstrap settles.
  const [bootstrapped, setBootstrapped] = useState(false);
  useEffect(() => {
    let active = true;
    async function bootstrapModelState(): Promise<void> {
      const modelStore = useModelStore.getState();
      const reattached = await modelStore.reattachExistingDownload();
      if (!reattached) {
        await modelStore.reconcile();
      }
    }

    void bootstrapModelState().finally(() => {
      if (active) {
        setBootstrapped(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (engineReady) {
      setEngineHostMounted(true);
    }
  }, [engineReady]);

  if (!bootstrapped) {
    return (
      <ErrorBoundary>
        <SplashScreen />
      </ErrorBoundary>
    );
  }

  const initialRouteName = resolveInitialRoute();

  return (
    <NavigationContainer>
      {engineHostMounted ? <InferenceEngineHost /> : null}
      {voiceEnabled ? <VoiceTranscriptionHost /> : null}
      <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Welcome" component={Welcome} />
        <Stack.Screen name="Chat" component={Chat} initialParams={{ conversationId: 'new' }} />
        <Stack.Screen name="Capture" component={Capture} />
        <Stack.Screen name="History" component={History} />
        <Stack.Screen name="ModelSetup" component={ModelSetup} />
        <Stack.Screen name="Benchmark" component={Benchmark} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
