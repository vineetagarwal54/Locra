import { GEMMA4_E2B_MM, LFM2_5_VL_1_6B_QUANTIZED } from 'react-native-executorch';

import {
  getModelCandidate,
  resolveDeveloperModelOverride,
} from '../../../src/model/ActiveModel';

jest.mock('react-native-executorch', () => ({
  GEMMA4_E2B_MM: { modelName: 'gemma4-e2b-multimodal' },
  LFM2_5_VL_1_6B_QUANTIZED: { modelName: 'lfm2.5-vl-1.6b-quantized' },
}));

describe('model candidate registry', () => {
  it('resolves both supported persisted IDs', () => {
    expect(getModelCandidate('LFM2_5_VL_1_6B_QUANTIZED').modelConstant).toBe(
      LFM2_5_VL_1_6B_QUANTIZED,
    );
    expect(getModelCandidate('GEMMA4_E2B_MM').modelConstant).toBe(GEMMA4_E2B_MM);
  });

  it('treats the environment selector as optional', () => {
    expect(resolveDeveloperModelOverride(undefined)).toBeNull();
    expect(resolveDeveloperModelOverride('unknown-model')).toBeNull();
    expect(resolveDeveloperModelOverride('gemma4_e2b')?.id).toBe('GEMMA4_E2B_MM');
  });
});
