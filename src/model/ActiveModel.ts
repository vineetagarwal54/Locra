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
  id: ModelCandidateId;
  modelConstant: ModelConstant;
  modelName: ModelConstant['modelName'];
  displayName: string;
  generationConfigId: string;
  integrityConfigEndpoint: string;
  integrityFallback: ModelIntegrityFallback;
}

const LFM: ModelCandidate = {
  id: 'LFM2_5_VL_1_6B_QUANTIZED',
  get modelConstant(): ModelConstant {
    return getExecutorch().LFM2_5_VL_1_6B_QUANTIZED;
  },
  modelName: 'lfm2.5-vl-1.6b-quantized',
  displayName: 'LFM2.5-VL 1.6B · Quantized',
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
  get modelConstant(): ModelConstant {
    return getExecutorch().GEMMA4_E2B_MM;
  },
  modelName: 'gemma4-e2b-multimodal',
  displayName: 'Gemma 4 E2B · Multimodal',
  generationConfigId: 'gemma4-e2b-mm-library-default',
  integrityConfigEndpoint:
    'https://raw.githubusercontent.com/vineetagarwal54/Locra/004-model-bake-off/model-configs/gemma-4-e2b-multimodal.json',
  integrityFallback: {
    expectedSha256: '56c6137e47ae5b64174259deb5d96a5d18bb86f2d992cfd96b65d869889b3fd2',
    expectedSize: 4_371_419_520,
  },
};

const MODEL_REGISTRY: Readonly<Record<ModelSelector, ModelCandidate>> = {
  lfm2_5_vl_1_6b: LFM,
  gemma4_e2b: GEMMA,
};

export function resolveActiveModel(
  raw: string | undefined = process.env.EXPO_PUBLIC_LOCRA_VLM
): ModelCandidate {
  if (raw === undefined || raw === '') {
    return LFM;
  }

  if (raw === 'lfm2_5_vl_1_6b' || raw === 'gemma4_e2b') {
    return MODEL_REGISTRY[raw];
  }

  throw new Error(
    `Invalid EXPO_PUBLIC_LOCRA_VLM value "${raw}". Expected "lfm2_5_vl_1_6b" or "gemma4_e2b".`
  );
}

export const activeModel = resolveActiveModel();

function getExecutorch(): ExecuTorchModule {
  // Lazy native access keeps metadata-only consumers testable without loading the native runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-executorch') as ExecuTorchModule;
}
