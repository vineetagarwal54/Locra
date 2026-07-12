import { getModelCandidate, type ModelCandidateId } from '../model/ActiveModel';

import { useInferenceStore } from './inferenceStore';
import { useModelSelectionStore } from './modelSelectionStore';
import { useModelStore } from './modelStore';

export type ModelSwitchRequestResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: string };

export async function selectModelForOnboarding(id: ModelCandidateId): Promise<boolean> {
  const ready = await initializeModel(id);
  useModelSelectionStore.getState().selectInitialModel(id);
  return ready;
}

export function requestModelSwitch(id: ModelCandidateId): ModelSwitchRequestResult {
  const selection = useModelSelectionStore.getState();
  if (selection.developerOverrideId !== null) {
    return { accepted: false, reason: 'Model switching is disabled by the developer override.' };
  }

  const inferenceStatus = useInferenceStore.getState().status;
  if (
    inferenceStatus === 'preprocessing' ||
    inferenceStatus === 'loading_model' ||
    inferenceStatus === 'streaming'
  ) {
    return { accepted: false, reason: 'Wait for the current response to finish.' };
  }

  const downloadStatus = useModelStore.getState().downloadStatus;
  if (downloadStatus === 'downloading' || downloadStatus === 'paused') {
    return { accepted: false, reason: 'Finish or cancel the current model download first.' };
  }

  selection.requestModelSwitch(id);
  return { accepted: true };
}

export async function commitRequestedModelSwitch(): Promise<boolean | null> {
  const selection = useModelSelectionStore.getState();
  const id = selection.pendingModelId;
  if (id === null) {
    return null;
  }
  const ready = await initializeModel(id);
  selection.commitPendingModelSwitch();
  return ready;
}

async function initializeModel(id: ModelCandidateId): Promise<boolean> {
  const model = getModelCandidate(id);
  const modelStore = useModelStore.getState();
  modelStore.initialize(model);
  const reattached = await useModelStore.getState().reattachExistingDownload();
  if (!reattached) {
    await useModelStore.getState().reconcile();
  }
  return useModelStore.getState().isReadyForInference();
}
