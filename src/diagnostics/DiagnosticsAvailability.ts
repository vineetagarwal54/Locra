export interface DiagnosticsAvailabilityInput {
  isDevBuild: boolean;
  isInternalBuild?: boolean;
}

export function isDiagnosticsExportAvailable(input: DiagnosticsAvailabilityInput): boolean {
  return input.isDevBuild || input.isInternalBuild === true;
}
