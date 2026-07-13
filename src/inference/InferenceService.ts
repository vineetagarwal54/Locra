import { getCurrentDeviceBuildMetadata } from '../diagnostics/DeviceBuildMetadataProvider';
import { QWEN_V1_DESCRIPTOR } from '../model/ActiveModel';
import { useModelStore } from '../store/modelStore';
import { useSettingsStore } from '../store/settingsStore';
import type { IInferenceQueue } from '../types/interfaces';

import { deviceResourcePolicy } from './DeviceResourcePolicy';
import { inferenceEngineAdapter } from './InferenceEngineRegistry';
import { createInferenceQueue } from './InferenceQueue';

const queue = createInferenceQueue(inferenceEngineAdapter, {
  isReadyForInference: (requiresVision) => requiresVision
    ? useModelStore.getState().isReadyForInference()
    : useModelStore.getState().isReadyForTextInference?.()
      ?? useModelStore.getState().isReadyForInference(),
  getResponseMode: () => useSettingsStore.getState().responseMode,
  resourcePolicy: deviceResourcePolicy,
  getDeviceBuildMetadata: getCurrentDeviceBuildMetadata,
  getModelAttribution: () => ({
    modelId: QWEN_V1_DESCRIPTOR.id,
    generationConfigId: QWEN_V1_DESCRIPTOR.generationConfigId,
  }),
});

export const inferenceQueue: IInferenceQueue = {
  submit: (request, options) => queue.submit(request, options),
  cancel: (): void => queue.cancel(),
  subscribe: (listener) => queue.subscribe(listener),
  getState: () => queue.getState(),
};
