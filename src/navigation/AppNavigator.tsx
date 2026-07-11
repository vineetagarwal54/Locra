import { createDrawerNavigator } from '@react-navigation/drawer';
import {
  getFocusedRouteNameFromRoute,
  NavigationContainer,
  useNavigationContainerRef,
  type NavigatorScreenParams,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ErrorBoundary, withErrorBoundary } from '../components/ErrorBoundary';
import { InferenceEngineHost } from '../components/InferenceEngineHost';
import { SplashScreen } from '../components/SplashScreen';
import { VoiceTranscriptionHost } from '../components/VoiceTranscriptionHost';
import { BenchmarkScreen } from '../screens/BenchmarkScreen';
import { CaptureScreen } from '../screens/CaptureScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { DiagnosticsExportScreen } from '../screens/DiagnosticsExportScreen';
import { DownloadProgressScreen } from '../screens/DownloadProgressScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { InsufficientStorageScreen } from '../screens/InsufficientStorageScreen';
import { ModelIntroScreen } from '../screens/ModelIntroScreen';
import { NotificationRationaleScreen } from '../screens/NotificationRationaleScreen';
import { PrivacyScreen } from '../screens/PrivacyScreen';
import { SuccessScreen } from '../screens/SuccessScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { useModelStore } from '../store/modelStore';
import { hasCompletedWelcome } from '../store/onboardingStore';
import { useVoiceStore } from '../store/voiceStore';

import { ConversationDrawer } from './ConversationDrawer';

export type RootStackParamList = {
  Welcome: undefined;
  Privacy: undefined;
  ModelIntro: undefined;
  NotificationRationale: undefined;
  DownloadProgress: { autoStart?: boolean } | undefined;
  InsufficientStorage: undefined;
  Success: undefined;
  Chat: { conversationId: string };
  Capture: { conversationId: string };
  History: undefined;
  Benchmark: undefined;
  DiagnosticsExport: undefined;
};

export type RootDrawerParamList = {
  Root: NavigatorScreenParams<RootStackParamList> | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<RootDrawerParamList>();

// Constitution Principle III: every screen is wrapped so a render crash in one
// degrades to a legible fallback instead of taking down the app.
const Welcome = withErrorBoundary(WelcomeScreen);
const Privacy = withErrorBoundary(PrivacyScreen);
const ModelIntro = withErrorBoundary(ModelIntroScreen);
const NotificationRationale = withErrorBoundary(NotificationRationaleScreen);
const DownloadProgress = withErrorBoundary(DownloadProgressScreen);
const InsufficientStorage = withErrorBoundary(InsufficientStorageScreen);
const Success = withErrorBoundary(SuccessScreen);
const Chat = withErrorBoundary(ChatScreen);
const Capture = withErrorBoundary(CaptureScreen);
const History = withErrorBoundary(HistoryScreen);
const Benchmark = withErrorBoundary(BenchmarkScreen);
const DiagnosticsExport = withErrorBoundary(DiagnosticsExportScreen);

// Launch gate, checked in order (per the onboarding flow, design.md §3.2 /
// screen_map.md Welcome → Privacy → Model Setup → …):
//   1. Never onboarded            → Welcome (starts the setup progression)
//   2. Onboarded, download live   → DownloadProgress (a reattached background
//                                    download resumes from persisted state)
//   3. Onboarded, model not ready → ModelIntro (download / re-download)
//   4. Onboarded, model ready     → Chat (new conversation)
// Returning users with a ready model land straight on New Chat.
function resolveInitialRoute(): keyof RootStackParamList {
  if (!hasCompletedWelcome()) {
    return 'Welcome';
  }
  const modelState = useModelStore.getState();
  if (!modelState.isReadyForInference()) {
    const status = modelState.downloadStatus;
    if (status === 'downloading' || status === 'paused') {
      return 'DownloadProgress';
    }
    return 'ModelIntro';
  }
  return 'Chat';
}

// Where a foreground return (e.g. tapping Locra's background-download
// notification) should land the user while the model is still being set up.
// Cold launches are already handled by resolveInitialRoute above; this covers a
// warm resume. It intentionally acts ONLY when a real background download is
// live (downloading/paused) so it never yanks a ready-model user or a user who
// chose "Not now" (not_started) out of Chat. A ready model reached in the
// background is finished by the DownloadProgress → Success effects, and a failed
// download keeps its in-place recovery card, so neither needs a redirect here.
function foregroundDownloadRoute(): 'DownloadProgress' | null {
  if (!hasCompletedWelcome()) {
    return null;
  }
  const modelState = useModelStore.getState();
  if (modelState.isReadyForInference()) {
    return null;
  }
  const status = modelState.downloadStatus;
  return status === 'downloading' || status === 'paused' ? 'DownloadProgress' : null;
}

// The stack owns every screen and the onboarding launch gate; the drawer (T046)
// wraps it so the conversation drawer is available app-wide.
function RootStack() {
  const initialRouteName = resolveInitialRoute();
  return (
    <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Welcome" component={Welcome} />
      <Stack.Screen name="Privacy" component={Privacy} />
      <Stack.Screen name="ModelIntro" component={ModelIntro} />
      <Stack.Screen name="NotificationRationale" component={NotificationRationale} />
      <Stack.Screen name="DownloadProgress" component={DownloadProgress} />
      <Stack.Screen name="InsufficientStorage" component={InsufficientStorage} />
      <Stack.Screen name="Success" component={Success} />
      <Stack.Screen name="Chat" component={Chat} initialParams={{ conversationId: 'new' }} />
      <Stack.Screen name="Capture" component={Capture} />
      <Stack.Screen name="History" component={History} />
      <Stack.Screen name="Benchmark" component={Benchmark} />
      <Stack.Screen name="DiagnosticsExport" component={DiagnosticsExport} />
    </Stack.Navigator>
  );
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

  // Route a foreground return (notification tap during an active background
  // download) to the live download screen. Preserves the background download
  // and reattach behavior — it only navigates, never touches the download.
  const navigationRef = useNavigationContainerRef<RootDrawerParamList>();
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      if (next !== 'active' || previous === 'active') {
        return;
      }
      if (!navigationRef.isReady()) {
        return;
      }
      const target = foregroundDownloadRoute();
      if (target === null || navigationRef.getCurrentRoute()?.name === target) {
        return;
      }
      navigationRef.navigate('Root', { screen: target });
    });
    return () => subscription.remove();
  }, [navigationRef]);

  if (!bootstrapped) {
    return (
      <ErrorBoundary>
        <SplashScreen />
      </ErrorBoundary>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <NavigationContainer ref={navigationRef}>
        {engineHostMounted ? <InferenceEngineHost /> : null}
        {voiceEnabled ? <VoiceTranscriptionHost /> : null}
        <Drawer.Navigator
          screenOptions={{ headerShown: false, drawerStyle: styles.drawer }}
          drawerContent={(props) => <ConversationDrawer {...props} />}
        >
          <Drawer.Screen
            name="Root"
            component={RootStack}
            options={({ route }) => ({
              // The drawer belongs to the chat experience only — the swipe
              // gesture must not open it over onboarding, model setup, the
              // camera viewfinder, or History (design.md §6: hamburger opens
              // the drawer; motion.md §10 keeps the gesture on chat).
              swipeEnabled:
                (getFocusedRouteNameFromRoute(route) ?? resolveInitialRoute()) === 'Chat',
            })}
          />
        </Drawer.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  drawer: {
    width: '82%',
  },
});
