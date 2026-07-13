jest.mock('../../../src/storage/mmkv', () => ({
  storage: {
    set: jest.fn(),
    getString: jest.fn(),
    getAllKeys: jest.fn((): string[] => []),
    remove: jest.fn(() => false),
  },
}));

import {
  DiagnosticsTraceStore,
  MAX_DIAGNOSTIC_TURNS_OVERALL,
  MAX_DIAGNOSTIC_TURNS_PER_CONVERSATION,
  type DiagnosticTurnRecord,
  type DiagnosticsStorage,
} from '../../../src/diagnostics/DiagnosticsTraceStore';

class TestDiagnosticsStorage implements DiagnosticsStorage {
  private readonly values = new Map<string, string | number | boolean | ArrayBuffer>();

  set(key: string, value: string | number | boolean | ArrayBuffer): void {
    this.values.set(key, value);
  }

  getString(key: string): string | undefined {
    const value = this.values.get(key);
    return typeof value === 'string' ? value : undefined;
  }

  remove(key: string): boolean {
    return this.values.delete(key);
  }

  get size(): number {
    return this.values.size;
  }
}

function makeRecord(overrides: Partial<DiagnosticTurnRecord> = {}): DiagnosticTurnRecord {
  return {
    id: overrides.id ?? 'turn-1',
    conversationId: overrides.conversationId ?? 'conversation-a',
    originatingUserMessageId: overrides.originatingUserMessageId ?? 'user-1',
    assistantMessageId: overrides.assistantMessageId ?? 'assistant-1',
    capturedAt: overrides.capturedAt ?? 1_700_000_000_000,
    trace: overrides.trace ?? {
      id: overrides.id ?? 'turn-1',
      createdAt: '2026-07-10T00:00:00.000Z',
      stages: [],
      finalResponse: 'An answer.',
    },
    objectiveResult: overrides.objectiveResult ?? null,
    contextDiagnostics: overrides.contextDiagnostics ?? null,
  };
}

describe('DiagnosticsTraceStore', () => {
  it('round-trips an appended turn and lists it back', () => {
    const store = new DiagnosticsTraceStore(new TestDiagnosticsStorage());
    store.append(makeRecord());

    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe('turn-1');
  });

  it('filters listed turns by conversation id', () => {
    const store = new DiagnosticsTraceStore(new TestDiagnosticsStorage());
    store.append(makeRecord({ id: 'turn-a', conversationId: 'conversation-a', capturedAt: 1 }));
    store.append(makeRecord({ id: 'turn-b', conversationId: 'conversation-b', capturedAt: 2 }));

    const listed = store.list(['conversation-a']);
    expect(listed.map((record) => record.id)).toEqual(['turn-a']);
  });

  it('returns turns ordered by capturedAt regardless of append order', () => {
    const store = new DiagnosticsTraceStore(new TestDiagnosticsStorage());
    store.append(makeRecord({ id: 'turn-later', capturedAt: 200 }));
    store.append(makeRecord({ id: 'turn-earlier', capturedAt: 100 }));

    const listed = store.list();
    expect(listed.map((record) => record.id)).toEqual(['turn-earlier', 'turn-later']);
  });

  it('evicts the oldest turns of a conversation once its per-conversation cap is exceeded', () => {
    const store = new DiagnosticsTraceStore(new TestDiagnosticsStorage());
    const total = MAX_DIAGNOSTIC_TURNS_PER_CONVERSATION + 5;
    for (let index = 0; index < total; index += 1) {
      store.append(makeRecord({ id: `turn-${index}`, conversationId: 'conversation-a', capturedAt: index }));
    }

    const listed = store.list(['conversation-a']);
    expect(listed).toHaveLength(MAX_DIAGNOSTIC_TURNS_PER_CONVERSATION);
    expect(listed[0]?.id).toBe(`turn-5`);
    expect(listed[listed.length - 1]?.id).toBe(`turn-${total - 1}`);
  });

  it('evicts globally oldest turns once the overall cap is exceeded', () => {
    const store = new DiagnosticsTraceStore(new TestDiagnosticsStorage());
    const conversations = MAX_DIAGNOSTIC_TURNS_OVERALL + 10;
    for (let index = 0; index < conversations; index += 1) {
      store.append(
        makeRecord({ id: `turn-${index}`, conversationId: `conversation-${index}`, capturedAt: index }),
      );
    }

    const listed = store.list();
    expect(listed).toHaveLength(MAX_DIAGNOSTIC_TURNS_OVERALL);
    expect(listed[0]?.id).toBe('turn-10');
  });

  it('never touches history keys when evicting diagnostics', () => {
    const storage = new TestDiagnosticsStorage();
    storage.set('history:ids', JSON.stringify(['conversation-a']));
    storage.set('history:session:conversation-a', JSON.stringify({ id: 'conversation-a' }));
    const store = new DiagnosticsTraceStore(storage);

    for (let index = 0; index < MAX_DIAGNOSTIC_TURNS_OVERALL + 5; index += 1) {
      store.append(makeRecord({ id: `turn-${index}`, conversationId: `conversation-${index}`, capturedAt: index }));
    }

    expect(storage.getString('history:ids')).toBe(JSON.stringify(['conversation-a']));
    expect(storage.getString('history:session:conversation-a')).toBe(
      JSON.stringify({ id: 'conversation-a' }),
    );
  });

  it('fails soft and skips malformed index entries and records', () => {
    const storage = new TestDiagnosticsStorage();
    storage.set('diagnostics:turn:index', 'not valid json');
    const store = new DiagnosticsTraceStore(storage);

    expect(store.list()).toEqual([]);
  });

  it('drops a record that is missing required fields instead of throwing', () => {
    const storage = new TestDiagnosticsStorage();
    const store = new DiagnosticsTraceStore(storage);
    store.append(makeRecord({ id: 'turn-good' }));

    storage.set('diagnostics:turn:record:turn-good', JSON.stringify({ garbage: true }));

    expect(store.list()).toEqual([]);
  });

  it('clears all diagnostic keys without throwing', () => {
    const storage = new TestDiagnosticsStorage();
    const store = new DiagnosticsTraceStore(storage);
    store.append(makeRecord());

    store.clear();

    expect(store.list()).toEqual([]);
  });
});
