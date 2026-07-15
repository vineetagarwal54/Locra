export const MODEL_BOOTSTRAP_TIMEOUT_MS = 10_000;

export type ModelBootstrapResult =
  | { status: 'completed' }
  | { status: 'timeout' }
  | { status: 'failed' }
  | { status: 'stale' };

export async function runModelBootstrap(input: {
  operation: Promise<void>;
  isCurrent: () => boolean;
  timeoutMs?: number;
}): Promise<ModelBootstrapResult> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<ModelBootstrapResult>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({ status: 'timeout' }),
      input.timeoutMs ?? MODEL_BOOTSTRAP_TIMEOUT_MS,
    );
  });
  const operation = input.operation.then<ModelBootstrapResult, ModelBootstrapResult>(
    () => input.isCurrent() ? { status: 'completed' } : { status: 'stale' },
    () => input.isCurrent() ? { status: 'failed' } : { status: 'stale' },
  );
  const result = await Promise.race([operation, timeout]);
  if (timeoutId !== null) clearTimeout(timeoutId);
  return result;
}
