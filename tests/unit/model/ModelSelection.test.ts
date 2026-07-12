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

  it('persists the user choice and restores it during bootstrap', () => {
    useModelSelectionStore.getState().bootstrap();
    useModelSelectionStore.getState().selectInitialModel('GEMMA4_E2B_MM');
    useModelSelectionStore.setState({ selectedModelId: null, bootstrapped: false });

    useModelSelectionStore.getState().bootstrap();

    expect(useModelSelectionStore.getState().selectedModelId).toBe('GEMMA4_E2B_MM');
  });

  it('routes completed onboarding without a selection to model selection', () => {
    expect(resolveLaunchRoute({
      welcomeCompleted: true,
      selectedModelId: null,
      modelReady: false,
      downloadStatus: 'not_started',
    })).toBe('ModelSelection');
  });
});
