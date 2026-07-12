type ExecuTorchModule = typeof import('react-native-executorch');

export type ModelCandidateId = 'LFM2_5_VL_1_6B_QUANTIZED' | 'GEMMA4_E2B_MM';
export type ModelSelector = 'lfm2_5_vl_1_6b' | 'gemma4_e2b';
export type ModelConstant =
  | ExecuTorchModule['LFM2_5_VL_1_6B_QUANTIZED']
  | ExecuTorchModule['GEMMA4_E2B_MM'];

export interface ModelIntegrityFallback {
  expectedSha256: string;
  expectedSize: number;
}

export interface ModelCandidate {
  readonly id: ModelCandidateId;
  readonly selector: ModelSelector;
  readonly modelConstant: ModelConstant;
  readonly modelName: ModelConstant['modelName'];
  readonly displayName: string;
  readonly description: string;
  readonly generationConfigId: string;
  readonly integrityConfigEndpoint: string;
  readonly integrityFallback: ModelIntegrityFallback;
}

const LFM: ModelCandidate = {
  id: 'LFM2_5_VL_1_6B_QUANTIZED',
  selector: 'lfm2_5_vl_1_6b',
  get modelConstant(): ModelConstant {
    return getExecutorch().LFM2_5_VL_1_6B_QUANTIZED;
  },
  modelName: 'lfm2.5-vl-1.6b-quantized',
  displayName: 'LFM2.5-VL 1.6B',
  description: 'A compact vision-language model with a smaller device footprint.',
  generationConfigId: 'lfm2.5-vl-official-v1',
  integrityConfigEndpoint:
    'https://raw.githubusercontent.com/vineetagarwal54/Locra/001-camera-vlm-qa/model-configs/lfm2.5-vl-1.6b-quantized.json',
  integrityFallback: {
    expectedSha256: 'd70133262bbd89e2f501380869e152252f761f6be4ccdd959fbd2305105035b4',
    expectedSize: 2_427_656_704,
  },
};

const GEMMA: ModelCandidate = {
  id: 'GEMMA4_E2B_MM',
  selector: 'gemma4_e2b',
  get modelConstant(): ModelConstant {
    return getExecutorch().GEMMA4_E2B_MM;
  },
  modelName: 'gemma4-e2b-multimodal',
  displayName: 'Gemma 4 E2B Multimodal',
  description: 'A larger multimodal model with higher storage and memory requirements.',
  generationConfigId: 'gemma4-e2b-mm-library-default',
  integrityConfigEndpoint:
    'https://raw.githubusercontent.com/vineetagarwal54/Locra/004-model-bake-off/model-configs/gemma-4-e2b-multimodal.json',
  integrityFallback: {
    expectedSha256: '56c6137e47ae5b64174259deb5d96a5d18bb86f2d992cfd96b65d869889b3fd2',
    expectedSize: 4_371_419_520,
  },
};

export const MODEL_CANDIDATES: ReadonlyArray<ModelCandidate> = [LFM, GEMMA];

const BY_ID: Readonly<Record<ModelCandidateId, ModelCandidate>> = {
  LFM2_5_VL_1_6B_QUANTIZED: LFM,
  GEMMA4_E2B_MM: GEMMA,
};

const BY_SELECTOR: Readonly<Record<ModelSelector, ModelCandidate>> = {
  lfm2_5_vl_1_6b: LFM,
  gemma4_e2b: GEMMA,
};

export function getModelCandidate(id: ModelCandidateId): ModelCandidate {
  return BY_ID[id];
}

export function isModelCandidateId(raw: string): raw is ModelCandidateId {
  return raw === 'LFM2_5_VL_1_6B_QUANTIZED' || raw === 'GEMMA4_E2B_MM';
}

export function resolveDeveloperModelOverride(raw: string | undefined): ModelCandidate | null {
  if (raw === undefined || raw === '') {
    return null;
  }
  if (raw === 'lfm2_5_vl_1_6b' || raw === 'gemma4_e2b') {
    return BY_SELECTOR[raw];
  }
  return null;
}

function getExecutorch(): ExecuTorchModule {
  // Native access stays lazy so bootstrap and metadata screens do not mount the runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-executorch') as ExecuTorchModule;
}
