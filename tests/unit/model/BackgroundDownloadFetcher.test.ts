import {
  BackgroundDownloadFetcher,
  type BackgroundDownloadFetcherDeps,
  type BgDownloadTask,
} from '../../../src/model/BackgroundDownloadFetcher';

// Let pending microtasks (the awaited ensureDownloadDir step) settle so the
// download task has been created before the test drives it.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// A controllable fake of a kesha DownloadTask. Chainable handler registration,
// with test-driven begin/progress/done/error triggers.
function fakeTask(id: string): BgDownloadTask & {
  emitProgress: (bytesDownloaded: number, bytesTotal: number) => void;
  emitDone: () => void;
  emitError: (e: unknown) => void;
  start: jest.Mock;
  pause: jest.Mock;
  resume: jest.Mock;
  stop: jest.Mock;
} {
  let onProgress: (p: { bytesDownloaded: number; bytesTotal: number }) => void = () => {};
  let onDone: () => void = () => {};
  let onError: (e: unknown) => void = () => {};
  const task = {
    id,
    progress(h: (p: { bytesDownloaded: number; bytesTotal: number }) => void) {
      onProgress = h;
      return task;
    },
    done(h: () => void) {
      onDone = h;
      return task;
    },
    error(h: (e: unknown) => void) {
      onError = h;
      return task;
    },
    start: jest.fn(),
    pause: jest.fn(async () => {}),
    resume: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    emitProgress: (bytesDownloaded: number, bytesTotal: number) => onProgress({ bytesDownloaded, bytesTotal }),
    emitDone: () => onDone(),
    emitError: (e: unknown) => onError(e),
  };
  return task;
}

const MODEL_URL = 'https://example.test/vl_1_6b/model.pte';
const TOKENIZER_URL = 'https://example.test/tokenizer.json';
const MODEL_DEST = '/data/user/0/com.locra.app/files/react-native-executorch/example.test_vl_1_6b_model.pte';
const TOKENIZER_DEST = '/data/user/0/com.locra.app/files/react-native-executorch/example.test_tokenizer.json';

function destFor(url: string): string {
  if (url === MODEL_URL) return MODEL_DEST;
  if (url === TOKENIZER_URL) return TOKENIZER_DEST;
  return `/dir/${url}`;
}

function makeHarness(overrides: Partial<BackgroundDownloadFetcherDeps> = {}) {
  const tasks = new Map<string, ReturnType<typeof fakeTask>>();
  const createDownloadTask = jest.fn((config: { id: string; url: string; destination: string }) => {
    const t = fakeTask(config.id);
    tasks.set(config.url, t);
    return t;
  });
  const present = new Set<string>();
  const deps: BackgroundDownloadFetcherDeps = {
    createDownloadTask,
    destinationForUrl: destFor,
    fileExists: (p: string) => present.has(p),
    deleteFileIfExists: jest.fn(async () => {}),
    listDownloadedFiles: jest.fn(async () => []),
    ensureDownloadDir: jest.fn(async () => {}),
    ...overrides,
  };
  const fetcher = new BackgroundDownloadFetcher(deps);
  return { fetcher, deps, tasks, createDownloadTask, present };
}

describe('BackgroundDownloadFetcher', () => {
  it('downloads a not-yet-present file to executorch\'s destination and reports wasDownloaded', async () => {
    const { fetcher, tasks, createDownloadTask } = makeHarness();
    const progress: number[] = [];

    const pending = fetcher.fetch((p) => progress.push(p), MODEL_URL);
    await flush();
    const task = tasks.get(MODEL_URL);
    if (!task) throw new Error('task not created');

    // kesha wrote the file to exactly the path executorch will look for.
    expect(createDownloadTask).toHaveBeenCalledWith(
      expect.objectContaining({ url: MODEL_URL, destination: MODEL_DEST }),
    );
    // The transfer is explicitly started (kesha tasks are PENDING until start()).
    expect(task.start).toHaveBeenCalledTimes(1);

    task.emitProgress(50, 100);
    task.emitDone();
    const result = await pending;

    expect(result.paths).toEqual([MODEL_DEST]);
    expect(result.wasDownloaded).toEqual([true]);
    expect(progress).toContain(0.5);
  });

  it('skips an already-present file without creating a download task', async () => {
    const { fetcher, createDownloadTask, present } = makeHarness();
    present.add(MODEL_DEST);

    const result = await fetcher.fetch(() => {}, MODEL_URL);

    expect(createDownloadTask).not.toHaveBeenCalled();
    expect(result.paths).toEqual([MODEL_DEST]);
    expect(result.wasDownloaded).toEqual([false]);
  });

  it('reports unified 0..1 progress aggregated across multiple sources', async () => {
    const { fetcher, tasks } = makeHarness();
    const progress: number[] = [];

    const pending = fetcher.fetch((p) => progress.push(p), MODEL_URL, TOKENIZER_URL);
    await flush();
    const model = tasks.get(MODEL_URL);
    const tok = tasks.get(TOKENIZER_URL);
    if (!model || !tok) throw new Error('tasks not created');

    model.emitProgress(0, 800);
    tok.emitProgress(0, 200);
    model.emitProgress(400, 800); // 400/1000 total
    expect(progress[progress.length - 1]).toBeCloseTo(0.4, 5);

    model.emitProgress(800, 800);
    tok.emitProgress(200, 200); // 1000/1000
    expect(progress[progress.length - 1]).toBeCloseTo(1, 5);

    model.emitDone();
    tok.emitDone();
    await pending;
  });

  it('rejects (throws) when a download errors, so the manager can mark it failed', async () => {
    const { fetcher, tasks } = makeHarness();
    const pending = fetcher.fetch(() => {}, MODEL_URL);
    await flush();
    const task = tasks.get(MODEL_URL);
    if (!task) throw new Error('task not created');

    task.emitError(new Error('network died'));

    await expect(pending).rejects.toThrow(/network died/);
  });

  it('pauseFetching pauses the active task; no-ops safely when nothing is active', async () => {
    const { fetcher, tasks } = makeHarness();
    const pending = fetcher.fetch(() => {}, MODEL_URL);
    await flush();
    const task = tasks.get(MODEL_URL);
    if (!task) throw new Error('task not created');

    await fetcher.pauseFetching(MODEL_URL);
    expect(task.pause).toHaveBeenCalled();

    // Nothing active for this URL → safe no-op, no throw.
    await expect(fetcher.pauseFetching('https://example.test/not-active')).resolves.toBeUndefined();

    task.emitDone();
    await pending;
  });

  it('resumeFetching resumes the active task; no-ops safely when nothing is paused', async () => {
    const { fetcher, tasks } = makeHarness();
    const pending = fetcher.fetch(() => {}, MODEL_URL);
    await flush();
    const task = tasks.get(MODEL_URL);
    if (!task) throw new Error('task not created');

    await fetcher.resumeFetching(MODEL_URL);
    expect(task.resume).toHaveBeenCalled();

    await expect(fetcher.resumeFetching('https://example.test/none')).resolves.toBeUndefined();

    task.emitDone();
    await pending;
  });

  it('cancelFetching stops the active task and deletes any partial file', async () => {
    const deleteFileIfExists = jest.fn(async () => {});
    const { fetcher, tasks } = makeHarness({ deleteFileIfExists });
    const pending = fetcher.fetch(() => {}, MODEL_URL).catch(() => undefined);
    await flush();
    const task = tasks.get(MODEL_URL);
    if (!task) throw new Error('task not created');

    await fetcher.cancelFetching(MODEL_URL);

    expect(task.stop).toHaveBeenCalled();
    expect(deleteFileIfExists).toHaveBeenCalledWith(MODEL_DEST);
    await pending;
  });

  it('deleteResources deletes the destination file for each given source', async () => {
    const deleteFileIfExists = jest.fn(async () => {});
    const { fetcher } = makeHarness({ deleteFileIfExists });

    await fetcher.deleteResources(MODEL_URL, TOKENIZER_URL);

    expect(deleteFileIfExists).toHaveBeenCalledWith(MODEL_DEST);
    expect(deleteFileIfExists).toHaveBeenCalledWith(TOKENIZER_DEST);
  });

  it('listDownloadedModels returns only .pte files', async () => {
    const listDownloadedFiles = jest.fn(async () => [MODEL_DEST, TOKENIZER_DEST]);
    const { fetcher } = makeHarness({ listDownloadedFiles });

    await expect(fetcher.listDownloadedModels()).resolves.toEqual([MODEL_DEST]);
  });
});
