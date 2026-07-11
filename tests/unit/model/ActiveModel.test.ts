import {
  GEMMA4_E2B_MM,
  LFM2_5_VL_1_6B_QUANTIZED,
} from 'react-native-executorch';

import { resolveActiveModel } from '../../../src/model/ActiveModel';

jest.mock('react-native-executorch', () => ({
  GEMMA4_E2B_MM: { modelName: 'gemma4-e2b-multimodal' },
  LFM2_5_VL_1_6B_QUANTIZED: { modelName: 'lfm2.5-vl-1.6b-quantized' },
}));

describe('resolveActiveModel', () => {
  it('defaults to LFM when the selector is undefined', () => {
    const candidate = resolveActiveModel(undefined);

    expect(candidate.id).toBe('LFM2_5_VL_1_6B_QUANTIZED');
    expect(candidate.modelConstant).toBe(LFM2_5_VL_1_6B_QUANTIZED);
  });

  it('selects LFM explicitly', () => {
    const candidate = resolveActiveModel('lfm2_5_vl_1_6b');

    expect(candidate.id).toBe('LFM2_5_VL_1_6B_QUANTIZED');
    expect(candidate.modelConstant).toBe(LFM2_5_VL_1_6B_QUANTIZED);
  });

  it('selects Gemma explicitly', () => {
    const candidate = resolveActiveModel('gemma4_e2b');

    expect(candidate.id).toBe('GEMMA4_E2B_MM');
    expect(candidate.modelConstant).toBe(GEMMA4_E2B_MM);
  });

  it('rejects an unrecognized non-empty selector', () => {
    expect(() => resolveActiveModel('unknown-model')).toThrow(
      /invalid EXPO_PUBLIC_LOCRA_VLM value.*unknown-model/i
    );
  });
});
