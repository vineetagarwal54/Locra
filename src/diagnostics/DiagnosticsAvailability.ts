// Diagnostics export ships in EVERY build — development, internal, and production.
// The former `__DEV__` / `EXPO_PUBLIC_INTERNAL_BETA` visibility gate is gone: the
// export is a supported, fully-offline user tool, so this always reports available.
export function isDiagnosticsExportAvailable(): boolean {
  return true;
}
