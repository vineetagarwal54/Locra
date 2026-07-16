import {
  isComposerReadOnlyForVoice,
  isVoiceSessionActive,
  joinDictation,
} from '../../../src/voice/dictationDraft';

describe('joinDictation', () => {
  it('preserves typed text and appends the dictated segment with one space', () => {
    expect(joinDictation('Remember to', 'buy milk')).toBe('Remember to buy milk');
  });

  it('does not double a space the user already typed before dictating', () => {
    expect(joinDictation('Remember to ', 'buy milk')).toBe('Remember to buy milk');
  });

  it('replaces the whole dictated segment on each incremental partial (never accumulates)', () => {
    const prefix = 'Note:';
    // Each partial is the CURRENT best transcript, not a delta.
    expect(joinDictation(prefix, 'hello')).toBe('Note: hello');
    expect(joinDictation(prefix, 'hello world')).toBe('Note: hello world');
    // The prefix is untouched no matter how the segment changes.
    expect(joinDictation(prefix, 'hello world today')).toBe('Note: hello world today');
  });

  it('returns just the prefix when the dictated segment is empty', () => {
    expect(joinDictation('kept text', '')).toBe('kept text');
    expect(joinDictation('kept text', '   ')).toBe('kept text');
  });

  it('returns just the dictated segment when there was no typed prefix', () => {
    expect(joinDictation('', 'fresh dictation')).toBe('fresh dictation');
    expect(joinDictation('   ', 'fresh dictation')).toBe('fresh dictation');
  });
});

describe('read-only / active predicates', () => {
  it('is read-only while preparing, recording, or finalizing', () => {
    expect(isComposerReadOnlyForVoice('preparing')).toBe(true);
    expect(isComposerReadOnlyForVoice('recording')).toBe(true);
    expect(isComposerReadOnlyForVoice('transcribing')).toBe(true);
  });

  it('restores editing at idle / ready / cancelled / failed', () => {
    expect(isComposerReadOnlyForVoice('idle')).toBe(false);
    expect(isComposerReadOnlyForVoice('ready')).toBe(false);
    expect(isComposerReadOnlyForVoice('cancelled')).toBe(false);
    expect(isComposerReadOnlyForVoice('failed')).toBe(false);
  });

  it('treats an active session the same as read-only for control locking', () => {
    expect(isVoiceSessionActive('recording')).toBe(true);
    expect(isVoiceSessionActive('ready')).toBe(false);
  });
});
