// The only file in this project permitted to import react-native-mmkv directly
// (constitution Principle VIII — MMKV is the sole persistence mechanism).
import { createMMKV } from 'react-native-mmkv';

export const storage = createMMKV({ id: 'locra-storage' });
