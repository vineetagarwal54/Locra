import { isDiagnosticsExportAvailable } from '../../../src/diagnostics/DiagnosticsAvailability';

describe('isDiagnosticsExportAvailable', () => {
  it('is available in every build, including production (gate removed)', () => {
    // The former __DEV__ / internal-beta gate is gone: export ships everywhere.
    expect(isDiagnosticsExportAvailable()).toBe(true);
  });
});
