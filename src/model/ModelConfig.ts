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
const FALLBACK_MODEL_CONFIG: ModelConfig = {
  expectedSha256: 'd70133262bbd89e2f501380869e152252f761f6be4ccdd959fbd2305105035b4',
  expectedSize: 2_427_656_704,
};

// The pinned expected download size (bytes) for the on-device model. Exposed for
// presentation only (the setup UI shows the download/storage figures before the
// remote config is fetched). This does not affect download or verification
// behavior, which always uses the fetched/fallback config above.
export const PINNED_MODEL_SIZE_BYTES = FALLBACK_MODEL_CONFIG.expectedSize;

export async function fetchModelConfig(
  endpoint: string,
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
    return FALLBACK_MODEL_CONFIG;
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
