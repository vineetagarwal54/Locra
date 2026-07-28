import type { ModelRequestMessage } from './ContextBuilder';
import type { GenerationRuntimeDiagnostics } from './InferenceEngineHandle';

export type InferenceTraceStageKind =
  | 'perception'
  | 'extractionRetry'
  | 'answer'
  | 'followUp';

export interface InferenceTraceStage {
  stage: InferenceTraceStageKind;
  modelInput: ModelRequestMessage[];
  rawOutput: string;
  parsedOutput?: unknown;
  processedOutput?: string;
  refusalRetry?: boolean;
  generationDiagnostics?: GenerationRuntimeDiagnostics;
}

export interface InferenceTrace {
  id: string;
  createdAt: string;
  stages: InferenceTraceStage[];
  finalResponse: string | null;
  conversationId?: string;
  originatingUserMessageId?: string;
  assistantMessageId?: string;
}

export function createInferenceTrace(): InferenceTrace {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    stages: [],
    finalResponse: null,
  };
}

export function isDevelopmentInferenceTraceEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined') {
    return __DEV__;
  }

  return process.env.NODE_ENV !== 'production';
}
