import { useEffect, useRef } from 'react';
import {
  LFM2_5_VL_1_6B_QUANTIZED,
  type Message,
  useLLM,
} from 'react-native-executorch';

import type { ModelRequestMessage } from './ContextBuilder';

// This file is the one sanctioned `useLLM` call site in the codebase. Locra
// owns conversation state; ExecuTorch is used only as a stateless inference
// runtime through `generate(messages)`.

export interface InferenceEngineHandle {
  /** Stateless model request. The caller supplies the full bounded context. */
  generate(messages: ModelRequestMessage[]): Promise<string>;
  /** Interrupts the in-flight generation (`llm.interrupt()`). */
  cancel(): void;
  /** Cumulative streamed response so far. */
  getResponse(): string;
  /** Whether a generation is currently in flight. */
  isGenerating(): boolean;
  /** Whether the model is loaded and ready to accept a request. */
  isReady(): boolean;
  /** Tokens generated so far in the current generation. */
  getGeneratedTokenCount(): number;
  /** Prompt tokens consumed by the current/last generation. */
  getPromptTokenCount(): number;
  /** Prompt + generated tokens consumed by the current/last generation. */
  getTotalTokenCount(): number;
  /** ExecuTorch managed history length; expected to stay empty. */
  getMessageHistoryLength(): number;
  /** Clears any managed history left by older runtime paths. */
  clearHistory(): void;
  /** Human-readable load/generation error, or null. */
  getError(): string | null;
  /** Fires on every streaming-relevant state change; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function useInferenceEngine(): InferenceEngineHandle {
  const llm = useLLM({ model: LFM2_5_VL_1_6B_QUANTIZED });
  const llmRef = useRef(llm);
  const listenersRef = useRef<Set<() => void>>(new Set());

  useEffect(() => {
    llmRef.current = llm;
    for (const listener of listenersRef.current) {
      listener();
    }
  }, [llm, llm.response, llm.token, llm.isGenerating, llm.isReady, llm.error]);

  const handleRef = useRef<InferenceEngineHandle | null>(null);
  if (handleRef.current === null) {
    const listeners = listenersRef.current;
    handleRef.current = {
      generate: async (messages: ModelRequestMessage[]): Promise<string> => {
        clearManagedHistory();
        return await llmRef.current.generate(messages as Message[]);
      },
      cancel: (): void => llmRef.current.interrupt(),
      getResponse: (): string => llmRef.current.response,
      isGenerating: (): boolean => llmRef.current.isGenerating,
      isReady: (): boolean => llmRef.current.isReady,
      getGeneratedTokenCount: (): number => llmRef.current.getGeneratedTokenCount(),
      getPromptTokenCount: (): number => llmRef.current.getPromptTokenCount(),
      getTotalTokenCount: (): number => llmRef.current.getTotalTokenCount(),
      getMessageHistoryLength: (): number => llmRef.current.messageHistory.length,
      clearHistory: clearManagedHistory,
      getError: (): string | null => (llmRef.current.error ? llmRef.current.error.message : null),
      subscribe: (listener: () => void): (() => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }

  return handleRef.current;

  function clearManagedHistory(): void {
    if (llmRef.current.messageHistory.length > 0) {
      llmRef.current.deleteMessage(0);
    }
  }
}
