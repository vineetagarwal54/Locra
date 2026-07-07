import { useEffect, useRef } from 'react';
import {
  LFM2_5_VL_1_6B_QUANTIZED,
  SlidingWindowContextStrategy,
  useLLM,
} from 'react-native-executorch';

import { RESPONSE_TOKEN_BUDGET } from './GenerationLimits';
import { LOCRA_GENERATION_CONFIG } from './GenerationTuning';
import { LOCRA_SYSTEM_PROMPT } from './SystemPrompt';

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
  submit(imagePath: string | null, prompt: string): Promise<string>;
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
  /** Prompt tokens consumed by the current/last generation. */
  getPromptTokenCount(): number;
  /** Prompt + generated tokens consumed by the current/last generation. */
  getTotalTokenCount(): number;
  /** Current managed-mode message history length, owned by `useLLM`. */
  getMessageHistoryLength(): number;
  /**
   * Clears the managed conversation history (FR-047) so a new capture starts
   * from a clean slate with zero context bleed from the prior thread.
   */
  clearHistory(): void;
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
  const configuredRef = useRef(false);

  // Refresh the ref, then notify subscribers — ordering matters so that a
  // listener reading getResponse()/getGeneratedTokenCount() sees fresh values.
  useEffect(() => {
    llmRef.current = llm;
    for (const listener of listenersRef.current) {
      listener();
    }
  }, [llm, llm.response, llm.token, llm.isGenerating, llm.isReady, llm.error]);

  const configureForLongResponses = (): void => {
    const current = llmRef.current;
    if (configuredRef.current || !current.isReady || current.messageHistory.length > 0) {
      return;
    }

    current.configure({
      chatConfig: {
        systemPrompt: LOCRA_SYSTEM_PROMPT,
        initialMessageHistory: [],
        contextStrategy: new SlidingWindowContextStrategy(RESPONSE_TOKEN_BUDGET),
      },
      // FR-051: only research.md-verified fields — no topK/maxTokens on 0.9.2.
      generationConfig: LOCRA_GENERATION_CONFIG,
    });
    configuredRef.current = true;
  };

  useEffect(() => {
    configureForLongResponses();
  }, [llm.isReady]);

  // Build the handle once so its identity is stable across re-renders.
  const handleRef = useRef<InferenceEngineHandle | null>(null);
  if (handleRef.current === null) {
    const listeners = listenersRef.current;
    handleRef.current = {
      submit: async (imagePath: string | null, prompt: string): Promise<string> => {
        configureForLongResponses();
        if (imagePath === null) {
          return await llmRef.current.sendMessage(prompt);
        }

        // The single, sanctioned sendMessage call — managed mode, vision media.
        return await llmRef.current.sendMessage(prompt, { imagePath });
      },
      cancel: (): void => llmRef.current.interrupt(),
      getResponse: (): string => llmRef.current.response,
      isGenerating: (): boolean => llmRef.current.isGenerating,
      isReady: (): boolean => llmRef.current.isReady,
      getGeneratedTokenCount: (): number => llmRef.current.getGeneratedTokenCount(),
      getPromptTokenCount: (): number => llmRef.current.getPromptTokenCount(),
      getTotalTokenCount: (): number => llmRef.current.getTotalTokenCount(),
      getMessageHistoryLength: (): number => llmRef.current.messageHistory.length,
      clearHistory: (): void => {
        // deleteMessage(0) drops every message from index 0 onward — the
        // managed-mode way to empty the conversation without re-configuring.
        if (llmRef.current.messageHistory.length > 0) {
          llmRef.current.deleteMessage(0);
        }
      },
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
