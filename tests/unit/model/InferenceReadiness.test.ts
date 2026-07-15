import { getInferenceReadiness } from '../../../src/model/InferenceReadiness';

describe('inference readiness guard', () => {
  it.each([
    ['checking', 'checking', 'wait'],
    ['not_installed', 'not_installed', 'open_setup'],
    ['preparing', 'downloading', 'wait'],
    ['downloading', 'downloading', 'wait'],
    ['paused', 'downloading', 'open_setup'],
    ['verifying', 'verifying', 'wait'],
    ['failed', 'failed', 'redownload'],
  ] as const)('blocks %s with typed recovery metadata', (setupPhase, reason, recoveryAction) => {
    expect(getInferenceReadiness({ setupPhase, integrityVerified: false })).toEqual(
      expect.objectContaining({ ready: false, reason, recoveryAction }),
    );
  });

  it('allows inference only for a verified ready bundle', () => {
    expect(getInferenceReadiness({ setupPhase: 'ready', integrityVerified: true })).toEqual({ ready: true });
    expect(getInferenceReadiness({ setupPhase: 'ready', integrityVerified: false }).ready).toBe(false);
  });
});
