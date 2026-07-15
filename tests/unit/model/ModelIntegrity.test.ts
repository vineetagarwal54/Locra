jest.mock('../../../src/native/NativeModelIntegrity', () => ({
  __esModule: true,
  default: {
    addListener: jest.fn(),
    verifyFile: jest.fn(),
  },
}));

import { verifyModelIntegrity } from '../../../src/model/ModelIntegrity';
import NativeModelIntegrity from '../../../src/native/NativeModelIntegrity';

if (NativeModelIntegrity === null) throw new Error('Native integrity mock was not installed.');
const mockAddListener = NativeModelIntegrity.addListener as jest.Mock;
const mockVerifyFile = NativeModelIntegrity.verifyFile as jest.Mock;
const mockRemove = jest.fn();

describe('verifyModelIntegrity native boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddListener.mockReturnValue({ remove: mockRemove });
  });

  it('delegates SHA-256 to native code and forwards only matching request progress', async () => {
    let listener!: (event: {
      requestId: string;
      bytesRead: number;
      totalBytes: number;
      progress: number;
    }) => void;
    mockAddListener.mockImplementation((_eventName, next) => {
      listener = next;
      return { remove: mockRemove };
    });
    mockVerifyFile.mockImplementation(async (requestId: string) => {
      listener({ requestId: 'stale', bytesRead: 1, totalBytes: 4, progress: 0.25 });
      listener({ requestId, bytesRead: 2, totalBytes: 4, progress: 0.5 });
      return true;
    });
    const progress = jest.fn();

    await expect(verifyModelIntegrity('/models/model.gguf', 'ABCD', progress)).resolves.toBe(true);

    expect(mockVerifyFile).toHaveBeenCalledWith(
      expect.stringMatching(/^model-integrity-/),
      '/models/model.gguf',
      'abcd',
    );
    expect(progress).toHaveBeenCalledWith({ bytesRead: 2, totalBytes: 4, progress: 0.5 });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalled();
  });

  it('returns false and removes the listener when native verification fails', async () => {
    mockVerifyFile.mockRejectedValue(new Error('native unavailable'));

    await expect(verifyModelIntegrity('/models/model.gguf', 'ff')).resolves.toBe(false);
    expect(mockRemove).toHaveBeenCalled();
  });
});
