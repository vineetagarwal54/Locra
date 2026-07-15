import { MODEL_BOOTSTRAP_TIMEOUT_MS, runModelBootstrap } from '../../../src/model/ModelBootstrap';

describe('model bootstrap', () => {
  afterEach(() => jest.useRealTimers());

  it('times out after the named bound and ignores a late stale completion', async () => {
    jest.useFakeTimers();
    let resolve!: () => void;
    const operation = new Promise<void>((done) => { resolve = done; });
    const isCurrent = jest.fn(() => true);
    const resultPromise = runModelBootstrap({ operation, isCurrent });

    jest.advanceTimersByTime(MODEL_BOOTSTRAP_TIMEOUT_MS);
    await expect(resultPromise).resolves.toEqual({ status: 'timeout' });
    isCurrent.mockReturnValue(false);
    resolve();
    await Promise.resolve();
    expect(isCurrent).toHaveBeenCalled();
  });

  it('returns an exception outcome instead of trapping bootstrap', async () => {
    await expect(runModelBootstrap({
      operation: Promise.reject(new Error('storage unavailable')),
      isCurrent: () => true,
    })).resolves.toEqual({ status: 'failed' });
  });
});
