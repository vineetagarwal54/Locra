import { fetchModelConfig, type ModelConfigFetch } from '../../../src/model/ModelConfig';

const ENDPOINT = 'https://example.test/model.json';
const HASH = 'a'.repeat(64);
const FALLBACK = {
  expectedSha256: 'd70133262bbd89e2f501380869e152252f761f6be4ccdd959fbd2305105035b4',
  expectedSize: 2_427_656_704,
};

function response(body: unknown, ok = true, status = 200): Awaited<ReturnType<ModelConfigFetch>> {
  return { ok, status, json: () => Promise.resolve(body) };
}

describe('fetchModelConfig', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warnSpy.mockRestore());

  it('fetches and validates the selected model config without memoizing', async () => {
    const fetcher = jest
      .fn<ReturnType<ModelConfigFetch>, Parameters<ModelConfigFetch>>()
      .mockResolvedValueOnce(response({ sha256: HASH, sizeBytes: 100 }))
      .mockResolvedValueOnce(response({ sha256: 'b'.repeat(64), size: 200 }));

    await expect(fetchModelConfig(ENDPOINT, FALLBACK, fetcher)).resolves.toEqual({
      expectedSha256: HASH,
      expectedSize: 100,
    });
    await expect(fetchModelConfig(ENDPOINT, FALLBACK, fetcher)).resolves.toEqual({
      expectedSha256: 'b'.repeat(64),
      expectedSize: 200,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses the supplied selected-model fallback on request or payload failure', async () => {
    const fetcher = jest.fn(async () => response({}, false, 503));

    await expect(fetchModelConfig(ENDPOINT, FALLBACK, fetcher)).resolves.toEqual(FALLBACK);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(ENDPOINT));
  });
});
