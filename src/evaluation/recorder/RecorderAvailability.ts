export interface RecorderAvailabilityInput {
  isDevBuild: boolean;
}

export function isEvaluationRecorderAvailable(input: RecorderAvailabilityInput): boolean {
  return input.isDevBuild;
}
