import type {
  EngineGenerateRequest,
  EngineGenerateResult,
  InferenceEngineAdapter,
  InferenceEngineHandle,
} from './InferenceEngineHandle';

let registeredEngine: InferenceEngineHandle | null = null;

export function registerInferenceEngine(handle: InferenceEngineHandle | null): void {
  registeredEngine = handle;
  handle?.clearHistory();
}

export function getRegisteredInferenceEngine(): InferenceEngineHandle | null {
  return registeredEngine;
}

function requireRegisteredEngine(): InferenceEngineHandle {
  if (registeredEngine === null) {
    throw new Error('The inference engine is not mounted yet.');
  }
  return registeredEngine;
}

export const inferenceEngineAdapter: InferenceEngineAdapter = {
  loadModel: (): Promise<void> => {
    const handle = requireRegisteredEngine();
    return new Promise<void>((resolve, reject) => {
      let unsubscribe: (() => void) | null = null;
      const settle = (): boolean => {
        const error = handle.getError();
        if (error !== null) {
          unsubscribe?.();
          reject(new Error(error));
          return true;
        }
        if (handle.isReady()) {
          unsubscribe?.();
          resolve();
          return true;
        }
        return false;
      };
      if (!settle()) {
        unsubscribe = handle.subscribe(settle);
      }
    });
  },

  generate: async (
    request: EngineGenerateRequest,
    onToken: (cumulativeResponse: string, generatedTokenCount?: number) => void,
    signal: AbortSignal,
  ): Promise<EngineGenerateResult> => {
    const handle = requireRegisteredEngine();
    const unsubscribe = handle.subscribe(() =>
      onToken(handle.getResponse(), handle.getGeneratedTokenCount()),
    );
    const onAbort = (): void => handle.cancel();
    if (signal.aborted) {
      handle.cancel();
    } else {
      signal.addEventListener('abort', onAbort);
    }

    try {
      if (signal.aborted) {
        throw new Error('Inference cancelled before model request was sent.');
      }
      const response = await handle.generate(request);
      if (!signal.aborted) {
        const error = handle.getError();
        if (error !== null) {
          throw new Error(error);
        }
      }
      handle.clearHistory();
      return {
        response,
        tokenCount: handle.getGeneratedTokenCount(),
        promptTokenCount: handle.getPromptTokenCount(),
        totalTokenCount: handle.getTotalTokenCount(),
        pinnedExtraction: null,
      };
    } finally {
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
    }
  },
};
