// Neutral runtime-selection types shared across the inference and model layers.
// Lives under types/ so the model-lifecycle layer can reference the host union
// without importing from inference/ (constitution Principle X boundary).

export type StartupRuntimeHost = 'qwen-llamarn';
