import { verifyModelIntegrity } from '../../../src/model/ModelIntegrity';

// expo-file-system pulls in a native module unavailable under Jest, so File is
// mocked. js-sha256 is pure JS, so it runs for real — the tests hash a known
// vector end-to-end through the chunked-read path.
jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  FileMode: { ReadOnly: 'r' },
}));

import { File } from 'expo-file-system';

const MockFile = File as unknown as jest.Mock;

interface FakeHandle {
  readBytes: jest.Mock;
  close: jest.Mock;
  offset: number;
  size: number;
}

// Serves at most 2 bytes per readBytes() call so even a tiny input exercises the
// multi-chunk incremental-hash loop and the EOF boundary.
function fakeHandle(bytes: Uint8Array): FakeHandle {
  let offset = 0;
  return {
    readBytes: jest.fn((length: number): Uint8Array => {
      const end = Math.min(offset + Math.min(length, 2), bytes.length);
      const chunk = bytes.subarray(offset, end);
      offset = end;
      return chunk;
    }),
    close: jest.fn(),
    offset: 0,
    size: bytes.length,
  };
}

function primeFile(opts: { exists: boolean; bytes?: Uint8Array; openError?: Error }): FakeHandle {
  const bytes = opts.bytes ?? new Uint8Array();
  const handle = fakeHandle(bytes);
  MockFile.mockImplementation(() => ({
    exists: opts.exists,
    size: bytes.length,
    open: jest.fn(() => {
      if (opts.openError) {
        throw opts.openError;
      }
      return handle;
    }),
  }));
  return handle;
}

// SHA-256("abc") — the canonical NIST test vector.
const ABC_BYTES = new Uint8Array([0x61, 0x62, 0x63]);
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('verifyModelIntegrity (streaming SHA-256)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('verifies true when the streamed file hash matches the pinned SHA-256', async () => {
    const handle = primeFile({ exists: true, bytes: ABC_BYTES });

    await expect(verifyModelIntegrity('file:///model.pte', ABC_SHA256)).resolves.toBe(true);

    // Proves it streamed in chunks (2 bytes at a time here) rather than reading
    // the whole file at once, and always released the handle.
    expect(handle.readBytes.mock.calls.length).toBeGreaterThan(1);
    expect(handle.close).toHaveBeenCalled();
  });

  it('is case-insensitive about the pinned digest', async () => {
    primeFile({ exists: true, bytes: ABC_BYTES });

    await expect(verifyModelIntegrity('file:///model.pte', ABC_SHA256.toUpperCase())).resolves.toBe(true);
  });

  it('verifies false when the streamed file hash does not match', async () => {
    primeFile({ exists: true, bytes: ABC_BYTES });

    await expect(verifyModelIntegrity('file:///model.pte', 'ff'.repeat(32))).resolves.toBe(false);
  });

  it('verifies false for a missing file without throwing (and never opens it)', async () => {
    const handle = primeFile({ exists: false });

    await expect(verifyModelIntegrity('file:///gone.pte', ABC_SHA256)).resolves.toBe(false);
    expect(handle.readBytes).not.toHaveBeenCalled();
  });

  it('verifies false without throwing if the file cannot be opened', async () => {
    primeFile({ exists: true, openError: new Error('permission denied') });

    await expect(verifyModelIntegrity('file:///unreadable.pte', ABC_SHA256)).resolves.toBe(false);
  });
});
