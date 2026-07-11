import { activeModel } from './ActiveModel';

export interface ModelConfig {
  expectedSha256: string;
  expectedSize: number;
}

interface ModelConfigResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type ModelConfigFetch = (
  url: string,
  init?: { headers: { Accept: 'application/json' } }
) => Promise<ModelConfigResponse>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export async function fetchModelConfig(
  endpoint: string = activeModel.integrityConfigEndpoint,
  fetcher: ModelConfigFetch = defaultFetch
): Promise<ModelConfig> {
  try {
    const response = await fetcher(endpoint, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Model config request failed with status ${response.status}.`);
    }

    return parseModelConfig(await response.json());
  } catch (error) {
    warnModelConfigFallback(endpoint, error);
    return activeModel.integrityFallback;
  }
}

function parseModelConfig(raw: unknown): ModelConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid model config payload.');
  }

  const record = raw as Record<string, unknown>;
  const sha256 = record.sha256;
  const sizeBytes = record.sizeBytes ?? record.size;

  if (
    typeof sha256 !== 'string' ||
    !SHA256_PATTERN.test(sha256) ||
    typeof sizeBytes !== 'number' ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    throw new Error('Invalid model config payload.');
  }

  return {
    expectedSha256: sha256.toLowerCase(),
    expectedSize: sizeBytes,
  };
}

async function defaultFetch(
  url: string,
  init?: { headers: { Accept: 'application/json' } }
): Promise<ModelConfigResponse> {
  if (typeof fetch !== 'function') {
    throw new Error('Model config fetch is unavailable.');
  }
  return fetch(url, init);
}

function warnModelConfigFallback(endpoint: string, error: unknown): void {
  const message =
    error instanceof Error && error.message.trim() !== ''
      ? error.message
      : 'Unknown model config fetch error.';
  // eslint-disable-next-line no-console
  console.warn(
    `[Locra] Model config fetch failed for ${endpoint}; using pinned fallback config. ${message}`
  );
}
