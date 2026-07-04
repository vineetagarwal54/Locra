import { Platform } from 'react-native';
import { getTotalMemorySync } from 'react-native-device-info';

import { checkDeviceCompatibility } from '../../../src/model/DeviceCompatibility';

jest.mock('react-native-device-info', () => ({
  getTotalMemorySync: jest.fn(),
}));

const mockGetTotalMemorySync = getTotalMemorySync as jest.Mock;

const GB = 1024 * 1024 * 1024;

function setPlatform(os: 'android' | 'ios', version: number): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
}

describe('checkDeviceCompatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports supported for sufficient RAM and Android 13+', () => {
    mockGetTotalMemorySync.mockReturnValue(8 * GB);
    setPlatform('android', 33);

    const result = checkDeviceCompatibility();

    expect(result.isSupported).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('reports unsupported with a non-null reason for insufficient RAM', () => {
    mockGetTotalMemorySync.mockReturnValue(4 * GB);
    setPlatform('android', 33);

    const result = checkDeviceCompatibility();

    expect(result.isSupported).toBe(false);
    expect(result.reason).not.toBeNull();
  });

  it('reports unsupported with a non-null reason for OS below API 33', () => {
    mockGetTotalMemorySync.mockReturnValue(8 * GB);
    setPlatform('android', 30);

    const result = checkDeviceCompatibility();

    expect(result.isSupported).toBe(false);
    expect(result.reason).not.toBeNull();
  });

  it('never throws when the device-info read throws, and reports unsupported with a reason', () => {
    mockGetTotalMemorySync.mockImplementation(() => {
      throw new Error('native module unavailable');
    });
    setPlatform('android', 33);

    expect(() => checkDeviceCompatibility()).not.toThrow();

    const result = checkDeviceCompatibility();
    expect(result.isSupported).toBe(false);
    expect(result.reason).not.toBeNull();
  });
});
