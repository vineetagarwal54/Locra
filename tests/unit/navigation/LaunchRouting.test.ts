import { resolveLaunchRoute } from '../../../src/navigation/LaunchRouting';
import type { ModelSetupPhase } from '../../../src/types/models';

describe('model launch routing', () => {
  it('keeps welcome completion separate from model readiness', () => {
    expect(resolveLaunchRoute({ welcomeCompleted: false, setupPhase: 'failed' })).toBe('Welcome');
  });

  it.each([
    ['ready', 'Chat'],
    ['downloading', 'DownloadProgress'],
    ['paused', 'DownloadProgress'],
    ['verifying', 'DownloadProgress'],
    ['not_installed', 'ModelIntro'],
    ['failed', 'ModelIntro'],
    ['checking', 'ModelIntro'],
  ] as ReadonlyArray<readonly [ModelSetupPhase, string]>)('routes %s to %s', (setupPhase, expected) => {
    expect(resolveLaunchRoute({ welcomeCompleted: true, setupPhase })).toBe(expected);
  });
});
