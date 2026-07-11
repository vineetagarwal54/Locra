import {
  fetchModelConfig,
  type ModelConfig,
  type ModelConfigFetch,
} from '../../../src/model/ModelConfig';

jest.mock('react-native-executorch', () => ({
  GEMMA4_E2B_MM: { modelName: 'gemma4-e2b-multimodal' },
  LFM2_5_VL_1_6B_QUANTIZED: { modelName: 'lfm2.5-vl-1.6b-quantized' },
}));

const ENDPOINT = 'https://example.test/models/lfm2.5-vl-1.6b-quantized.json';
const HASH = 'a'.repeat(64);
const FALLBACK_HASH = 'd70133262bbd89e2f501380869e152252f761f6be4ccdd959fbd2305105035b4';
const GEMMA_ENDPOINT = 'https://example.test/models/gemma-4-e2b-multimodal.json';
const GEMMA_FALLBACK_HASH = '56c6137e47ae5b64174259deb5d96a5d18bb86f2d992cfd96b65d869889b3fd2';
const GEMMA_FALLBACK_SIZE = 4_371_419_520;

function response(body: unknown, ok = true, status = 200): Awaited<ReturnType<ModelConfigFetch>> {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('fetchModelConfig', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('fetches and validates the expected SHA-256 hash and file size', async () => {
    const fetcher = jest.fn(async () => response({ sha256: HASH, sizeBytes: 2_427_656_704 }));

    const config = await fetchModelConfig(ENDPOINT, fetcher);

    expect(config).toEqual<ModelConfig>({
      expectedSha256: HASH,
      expectedSize: 2_427_656_704,
    });
    expect(fetcher).toHaveBeenCalledWith(ENDPOINT, {
      headers: { Accept: 'application/json' },
    });
  });

  it('accepts the public config payload shape using size', async () => {
    const fetcher = jest.fn(async () => response({ sha256: HASH, size: 2_427_656_704 }));

    await expect(fetchModelConfig(ENDPOINT, fetcher)).resolves.toEqual({
      expectedSha256: HASH,
      expectedSize: 2_427_656_704,
    });
  });

  it('does not memoize between calls', async () => {
    const fetcher = jest
      .fn<ReturnType<ModelConfigFetch>, Parameters<ModelConfigFetch>>()
      .mockResolvedValueOnce(response({ sha256: 'b'.repeat(64), sizeBytes: 100 }))
      .mockResolvedValueOnce(response({ sha256: 'c'.repeat(64), sizeBytes: 200 }));

    await expect(fetchModelConfig(ENDPOINT, fetcher)).resolves.toEqual({
      expectedSha256: 'b'.repeat(64),
      expectedSize: 100,
    });
    await expect(fetchModelConfig(ENDPOINT, fetcher)).resolves.toEqual({
      expectedSha256: 'c'.repeat(64),
      expectedSize: 200,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('falls back to pinned values and warns on non-2xx responses', async () => {
    const fetcher = jest.fn(async () => response({ sha256: HASH, sizeBytes: 1 }, false, 503));

    await expect(fetchModelConfig(ENDPOINT, fetcher)).resolves.toEqual({
      expectedSha256: FALLBACK_HASH,
      expectedSize: 2_427_656_704,
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('using pinned fallback config'));
  });

  it('falls back to pinned values and warns on malformed JSON payloads', async () => {
    const fetcher = jest.fn(async () => response({ sha256: 'not-a-hash', sizeBytes: -1 }));

    await expect(fetchModelConfig(ENDPOINT, fetcher)).resolves.toEqual({
      expectedSha256: FALLBACK_HASH,
      expectedSize: 2_427_656_704,
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('using pinned fallback config'));
  });

  it('falls back to pinned values and warns when the request rejects', async () => {
    const fetcher = jest.fn(async () => {
      throw new Error('Unable to resolve host "locra.app"');
    });

    await expect(fetchModelConfig(ENDPOINT, fetcher)).resolves.toEqual({
      expectedSha256: FALLBACK_HASH,
      expectedSize: 2_427_656_704,
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unable to resolve host'));
  });

  it('uses the active Gemma endpoint and Gemma-specific integrity fallback', async () => {
    jest.resetModules();
    jest.doMock('../../../src/model/ActiveModel', () => ({
      activeModel: {
        integrityConfigEndpoint: GEMMA_ENDPOINT,
        integrityFallback: {
          expectedSha256: GEMMA_FALLBACK_HASH,
          expectedSize: GEMMA_FALLBACK_SIZE,
        },
      },
    }));
    const { fetchModelConfig: fetchGemmaModelConfig } = require('../../../src/model/ModelConfig') as typeof import('../../../src/model/ModelConfig');
    const fetcher = jest.fn(async () => response({}, false, 503));

    await expect(fetchGemmaModelConfig(undefined, fetcher)).resolves.toEqual({
      expectedSha256: GEMMA_FALLBACK_HASH,
      expectedSize: GEMMA_FALLBACK_SIZE,
    });
    expect(fetcher).toHaveBeenCalledWith(GEMMA_ENDPOINT, {
      headers: { Accept: 'application/json' },
    });
  });
});
