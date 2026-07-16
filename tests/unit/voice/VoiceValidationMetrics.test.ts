import { DEFAULT_VOICE_MODEL } from '../../../src/voice/VoiceModelDescriptor';
import { VoiceValidationRun } from '../../../src/voice/VoiceValidationMetrics';

describe('VoiceValidationRun', () => {
  it('derives the device-gate metrics from timestamped lifecycle events', () => {
    let clock = 0;
    const run = new VoiceValidationRun(DEFAULT_VOICE_MODEL, () => clock);

    clock = 100; run.markStart();
    clock = 400; run.markInitialized();       // init = 300ms
    clock = 900; run.markPartial();           // first partial = 800ms
    clock = 1100; run.markPartial();          // interval 200ms
    clock = 1400; run.markPartial();          // interval 300ms
    clock = 2000; run.markStopRequested();
    clock = 2300; run.markFinal();            // final latency = 300ms
    clock = 2300; run.markReleaseStart();
    clock = 2450; run.markReleaseDone();      // release = 150ms
    run.sampleMemory(10);
    run.sampleMemory(42);
    run.sampleMemory(7);

    const report = run.build();
    expect(report.initMs).toBe(300);
    expect(report.firstPartialLatencyMs).toBe(800);
    expect(report.partialUpdateCount).toBe(3);
    expect(report.meanPartialIntervalMs).toBe(250);
    expect(report.finalTranscriptLatencyMs).toBe(300);
    expect(report.releaseMs).toBe(150);
    expect(report.peakMemoryBytes).toBe(42);
    expect(report.cancelled).toBe(false);
    expect(report.airplaneModeResult).toBe('not-tested');
    expect(report.model).toEqual({
      id: DEFAULT_VOICE_MODEL.id,
      displayName: DEFAULT_VOICE_MODEL.displayName,
      approxSizeBytes: DEFAULT_VOICE_MODEL.approxSizeBytes,
    });
  });

  it('reports nulls for metrics whose events never fired and records cancellation', () => {
    const run = new VoiceValidationRun(DEFAULT_VOICE_MODEL, () => 0);
    run.markStart();
    run.markCancelled();
    const report = run.build();
    expect(report.firstPartialLatencyMs).toBeNull();
    expect(report.meanPartialIntervalMs).toBeNull();
    expect(report.finalTranscriptLatencyMs).toBeNull();
    expect(report.cancelled).toBe(true);
  });
});
