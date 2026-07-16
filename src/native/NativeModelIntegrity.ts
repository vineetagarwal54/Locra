import {
  requireOptionalNativeModule,
  type EventSubscription,
} from 'expo-modules-core';

export interface ModelIntegrityProgressEvent {
  requestId: string;
  bytesRead: number;
  totalBytes: number;
  progress: number;
}

export interface ModelIntegrityNativeModule {
  addListener(
    eventName: 'onProgress',
    listener: (event: ModelIntegrityProgressEvent) => void,
  ): EventSubscription;
  verifyFile(requestId: string, fileUri: string, expectedSha256: string): Promise<boolean>;
}

export default requireOptionalNativeModule<ModelIntegrityNativeModule>('LocraModelIntegrity');
