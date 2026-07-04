import { registerRootComponent } from 'expo';
import { initExecutorch } from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';

import App from './App';

// Must run before any component calls useLLM — ResourceFetcher.getAdapter() throws
// ResourceFetcherAdapterNotInitialized otherwise (research.md "Initialization sequence").
initExecutorch({ resourceFetcher: ExpoResourceFetcher });

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
