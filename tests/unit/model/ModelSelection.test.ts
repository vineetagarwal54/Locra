const mockValues = new Map<string, string>();

jest.mock('../../../src/storage/mmkv', () => ({
  storage: {
    getString: jest.fn((key: string) => mockValues.get(key)),
    set: jest.fn((key: string, value: string) => mockValues.set(key, value)),
  },
}));

import { resolveLaunchRoute } from '../../../src/navigation/LaunchRouting';
import { useModelSelectionStore } from '../../../src/store/modelSelectionStore';

describe('persisted runtime model selection', () => {
  const originalOverride = process.env.EXPO_PUBLIC_LOCRA_VLM;

  beforeEach(() => {
    mockValues.clear();
    delete process.env.EXPO_PUBLIC_LOCRA_VLM;
    useModelSelectionStore.setState({
      bootstrapped: false,
      selectedModelId: null,
      developerOverrideId: null,
      pendingModelId: null,
    });
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_LOCRA_VLM = originalOverride;
  });

  it('persists the selected model and restores it during bootstrap', () => {
    useModelSelectionStore.getState().bootstrap();
    useModelSelectionStore.getState().selectInitialModel('QWEN3_VL_2B_INSTRUCT_Q4_K_M');
    useModelSelectionStore.setState({ selectedModelId: null, bootstrapped: false });

    useModelSelectionStore.getState().bootstrap();

    expect(useModelSelectionStore.getState().selectedModelId).toBe('QWEN3_VL_2B_INSTRUCT_Q4_K_M');
  });

  it('defaults the single V1 model selection during bootstrap (no picker)', () => {
    useModelSelectionStore.getState().bootstrap();
    expect(useModelSelectionStore.getState().selectedModelId).toBe('QWEN3_VL_2B_INSTRUCT_Q4_K_M');
  });

  it('still routes a null selection to model selection at the routing layer', () => {
    expect(resolveLaunchRoute({
      welcomeCompleted: true,
      selectedModelId: null,
      modelReady: false,
      downloadStatus: 'not_started',
    })).toBe('ModelSelection');
  });
});
