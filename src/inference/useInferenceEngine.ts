import { useEffect, useRef } from 'react';
import { LFM2_5_VL_1_6B_QUANTIZED, useLLM } from 'react-native-executorch';

// ─────────────────────────────────────────────────────────────────────────────
// This file is the ONE sanctioned `useLLM` call site in the entire codebase
// (constitution Principle X / research.md "Architecture boundary tension"). No
// other module may import `useLLM`. It exists solely to isolate ExecuTorch's
// hook-shaped streaming state (`response`, `token`, `isGenerating`, `interrupt`)
// behind a plain-function handle the InferenceQueue can drive from outside React.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Plain-function surface over the `useLLM` hook. The four core methods
 * (`submit` / `cancel` / `getResponse` / `isGenerating`) are what the
 * InferenceQueue's engine bridge consumes; `isReady`, `getGeneratedTokenCount`,
 * `getError`, and `subscribe` are the minimal additions the queue needs to gate
 * on model readiness, compute tokens/sec (FR-008), surface load errors, and
 * detect the first streamed token — none of which ExecuTorch exposes any other
 * way (research.md "Impact on metrics").
 */
export interface InferenceEngineHandle {
  /** Managed-mode multimodal request: `sendMessage(prompt, { imagePath })`. */
  submit(imagePath: string, prompt: string): Promise<void>;
  /** Interrupts the in-flight generation (`llm.interrupt()`). */
  cancel(): void;
  /** Cumulative streamed response so far. */
  getResponse(): string;
  /** Whether a generation is currently in flight. */
  isGenerating(): boolean;
  /** Whether the model is loaded and ready to accept a request. */
  isReady(): boolean;
  /** Tokens generated so far in the current generation (drives tokens/sec). */
  getGeneratedTokenCount(): number;
  /** Human-readable load/generation error, or null. */
  getError(): string | null;
  /** Fires on every streaming-relevant state change; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * Mounts the LFM2.5-VL-1.6B (quantized) vision-language model via `useLLM` and
 * returns a stable {@link InferenceEngineHandle}. Call this exactly once from a
 * host component high in the tree; register the returned handle with the
 * inferenceStore so screens (which never touch this module) drive it indirectly.
 */
export function useInferenceEngine(): InferenceEngineHandle {
  const llm = useLLM({ model: LFM2_5_VL_1_6B_QUANTIZED });

  // Latest hook state, readable synchronously from the plain-function handle
  // (the InferenceQueue lives outside React and cannot read hook state directly).
  const llmRef = useRef(llm);
  const listenersRef = useRef<Set<() => void>>(new Set());

  // Refresh the ref, then notify subscribers — ordering matters so that a
  // listener reading getResponse()/getGeneratedTokenCount() sees fresh values.
  useEffect(() => {
    llmRef.current = llm;
    for (const listener of listenersRef.current) {
      listener();
    }
  }, [llm, llm.response, llm.token, llm.isGenerating, llm.isReady, llm.error]);

  // Build the handle once so its identity is stable across re-renders.
  const handleRef = useRef<InferenceEngineHandle | null>(null);
  if (handleRef.current === null) {
    const listeners = listenersRef.current;
    handleRef.current = {
      submit: async (imagePath: string, prompt: string): Promise<void> => {
        // The single, sanctioned sendMessage call — managed mode, vision media.
        await llmRef.current.sendMessage(prompt, { imagePath });
      },
      cancel: (): void => llmRef.current.interrupt(),
      getResponse: (): string => llmRef.current.response,
      isGenerating: (): boolean => llmRef.current.isGenerating,
      isReady: (): boolean => llmRef.current.isReady,
      getGeneratedTokenCount: (): number => llmRef.current.getGeneratedTokenCount(),
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
}
