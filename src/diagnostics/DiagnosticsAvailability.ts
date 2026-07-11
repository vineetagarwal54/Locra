export interface DiagnosticsAvailabilityInput {
  isDevBuild: boolean;
}

export function isDiagnosticsExportAvailable(input: DiagnosticsAvailabilityInput): boolean {
  return input.isDevBuild;
}
