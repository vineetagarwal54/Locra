import { File } from 'expo-file-system';
import { useEffect, useRef } from 'react';

import type { ModelRequestMessage } from '../ContextBuilder';
import type { InferenceEngineHandle } from '../InferenceEngineHandle';

import { QwenLlamaRuntime, type LlamaBinding } from './QwenLlamaRuntime';

// The sole Qwen llama.rn call site. This hook owns the private runtime lifecycle
// (load on mount, release on unmount) and adapts the promise-based runtime to the
// runtime-neutral streaming `InferenceEngineHandle` consumed by the queue/store.
// The native llama.rn binding is required lazily so metadata/bootstrap screens
// never mount the native runtime.

export interface QwenArtifactPaths {
  modelPath: string;
  projectorPath: string;
}

interface EngineState {
  response: string;
  generating: boolean;
  ready: boolean;
  error: string | null;
  generatedTokens: number;
  promptTokens: number;
  totalTokens: number;
}

const INITIAL_ENGINE_STATE: EngineState = {
  response: '',
  generating: false,
  ready: false,
  error: null,
  generatedTokens: 0,
  promptTokens: 0,
  totalTokens: 0,
};

function loadLlamaBinding(): LlamaBinding {
  // Native access stays lazy so only the mounted Qwen host loads llama.rn.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const llama = require('llama.rn') as LlamaBinding;
  return { initLlama: llama.initLlama, releaseAllLlama: llama.releaseAllLlama };
}

function isReadableFile(fileUri: string): boolean {
  try {
    const file = new File(fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`);
    return file.exists && (file.size ?? 0) > 0;
  } catch {
    return false;
  }
}

export function useQwenInferenceEngine(paths: QwenArtifactPaths): InferenceEngineHandle {
  const runtimeRef = useRef<QwenLlamaRuntime | null>(null);
  const stateRef = useRef<EngineState>({ ...INITIAL_ENGINE_STATE });
  const listenersRef = useRef<Set<() => void>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const runtime = new QwenLlamaRuntime({ llama: loadLlamaBinding(), isReadableFile });
    runtimeRef.current = runtime;
    let disposed = false;

    runtime
      .loadModel({ modelPath: paths.modelPath, projectorPath: paths.projectorPath })
      .then(() => {
        if (!disposed) {
          setState({ ready: true, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setState({ ready: false, error: toMessage(error) });
        }
      });

    return () => {
      disposed = true;
      void runtime.release();
      runtimeRef.current = null;
    };
  }, [paths.modelPath, paths.projectorPath]);

  const handleRef = useRef<InferenceEngineHandle | null>(null);
  if (handleRef.current === null) {
    handleRef.current = {
      generate: async (messages: ModelRequestMessage[]): Promise<string> => {
        const runtime = runtimeRef.current;
        if (runtime === null) {
          throw new Error('The Qwen runtime is not available.');
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setState({ response: '', generating: true, error: null, generatedTokens: 0 });
        try {
          const result = await runtime.generate({
            messages,
            signal: controller.signal,
            onToken: (cumulativeText, generatedTokenCount) => {
              setState({
                response: cumulativeText,
                generatedTokens: generatedTokenCount ?? stateRef.current.generatedTokens,
              });
            },
          });
          setState({
            response: result.text,
            generating: false,
            generatedTokens: result.generatedTokens,
            promptTokens: result.promptTokens,
            totalTokens: result.totalTokens,
          });
          return result.text;
        } catch (error) {
          setState({ generating: false, error: toMessage(error) });
          throw error;
        } finally {
          abortRef.current = null;
        }
      },
      cancel: (): void => {
        abortRef.current?.abort();
        runtimeRef.current?.cancel();
      },
      getResponse: (): string => stateRef.current.response,
      isGenerating: (): boolean => stateRef.current.generating,
      isReady: (): boolean => runtimeRef.current?.getStatus() === 'loaded',
      getGeneratedTokenCount: (): number => stateRef.current.generatedTokens,
      getPromptTokenCount: (): number => stateRef.current.promptTokens,
      getTotalTokenCount: (): number => stateRef.current.totalTokens,
      // Locra owns all conversation context; the runtime keeps no native history.
      getMessageHistoryLength: (): number => 0,
      clearHistory: (): void => {},
      getError: (): string | null => stateRef.current.error ?? runtimeRef.current?.getError() ?? null,
      subscribe: (listener: () => void): (() => void) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    };
  }

  return handleRef.current;

  function setState(patch: Partial<EngineState>): void {
    stateRef.current = { ...stateRef.current, ...patch };
    for (const listener of listenersRef.current) {
      listener();
    }
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : 'Qwen runtime error.';
}
