import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately. Qwen3-VL via llama.rn is the only
// on-device runtime; no ExecuTorch initialization is required.
registerRootComponent(App);
