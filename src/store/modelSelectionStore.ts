import { create } from 'zustand';

import {
  ACTIVE_V1_MODEL_ID,
  getModelCandidate,
  isModelCandidateId,
  resolveDeveloperModelOverride,
  type ModelCandidate,
  type ModelCandidateId,
} from '../model/ActiveModel';
import { storage } from '../storage/mmkv';

const SELECTED_MODEL_KEY = 'model:selected-id';

interface ModelSelectionState {
  bootstrapped: boolean;
  selectedModelId: ModelCandidateId | null;
  developerOverrideId: ModelCandidateId | null;
  pendingModelId: ModelCandidateId | null;
  bootstrap: () => void;
  selectInitialModel: (id: ModelCandidateId) => void;
  requestModelSwitch: (id: ModelCandidateId) => void;
  commitPendingModelSwitch: () => ModelCandidateId | null;
  cancelModelSwitch: () => void;
}

export const useModelSelectionStore = create<ModelSelectionState>((set, get) => ({
  bootstrapped: false,
  selectedModelId: null,
  developerOverrideId: null,
  pendingModelId: null,
  bootstrap: (): void => {
    const override = resolveDeveloperModelOverride(process.env.EXPO_PUBLIC_LOCRA_VLM);
    const persisted = readPersistedModelId();
    // Locra V1 has a single model (Qwen). There is no picker: default the selection
    // to the active V1 model so onboarding goes straight to intro/download.
    set({
      bootstrapped: true,
      developerOverrideId: override?.id ?? null,
      selectedModelId: override?.id ?? persisted ?? ACTIVE_V1_MODEL_ID,
      pendingModelId: null,
    });
  },
  selectInitialModel: (id: ModelCandidateId): void => {
    if (get().developerOverrideId !== null) {
      return;
    }
    persistModelId(id);
    set({ selectedModelId: id, pendingModelId: null });
  },
  requestModelSwitch: (id: ModelCandidateId): void => {
    if (get().developerOverrideId !== null || get().selectedModelId === id) {
      return;
    }
    set({ pendingModelId: id });
  },
  commitPendingModelSwitch: (): ModelCandidateId | null => {
    const id = get().pendingModelId;
    if (id === null) {
      return null;
    }
    persistModelId(id);
    set({ selectedModelId: id, pendingModelId: null });
    return id;
  },
  cancelModelSwitch: (): void => set({ pendingModelId: null }),
}));

export function getSelectedModel(): ModelCandidate | null {
  const id = useModelSelectionStore.getState().selectedModelId;
  return id === null ? null : getModelCandidate(id);
}

export function requireSelectedModel(): ModelCandidate {
  const selected = getSelectedModel();
  if (selected === null) {
    throw new Error('A model must be selected before initializing model services.');
  }
  return selected;
}

function readPersistedModelId(): ModelCandidateId | null {
  const raw = storage.getString(SELECTED_MODEL_KEY);
  return raw !== undefined && isModelCandidateId(raw) ? raw : null;
}

function persistModelId(id: ModelCandidateId): void {
  storage.set(SELECTED_MODEL_KEY, id);
}
