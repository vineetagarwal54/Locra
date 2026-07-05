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
  endpoint: string,
  fetcher: ModelConfigFetch = defaultFetch
): Promise<ModelConfig> {
  const response = await fetcher(endpoint, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Model config request failed with status ${response.status}.`);
  }

  return parseModelConfig(await response.json());
}

function parseModelConfig(raw: unknown): ModelConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid model config payload.');
  }

  const record = raw as Record<string, unknown>;
  const sha256 = record.sha256;
  const sizeBytes = record.sizeBytes;

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
