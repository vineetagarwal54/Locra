# Contract: History Store Module

Enforces constitution Principle VIII (MMKV is the only persistence
mechanism; no AsyncStorage) and backs User Stories 3 and 4, and
FR-015 through FR-019. Screens depend on this module; it depends on MMKV
only — no dependency on the inference or model-lifecycle modules (it
receives a completed `QASession` as a plain value, it does not reach into
the inference module to obtain one).

## Public interface

```ts
interface HistoryStore {
  save(session: QASession): void;               // session.status MUST already be a terminal state
  list(): QASession[];                           // newest first
  get(id: string): QASession | null;
  delete(id: string): void;
  clear(): void;
  setFlag(id: string, flagged: boolean, note?: string): void;
}
```

## Preconditions

- `save()` MUST only be called with a `QASession` whose `status` is
  `'completed'`, `'cancelled'`, or `'errored'` — never `'streaming'`
  (data-model.md's state machine: streaming sessions are never persisted).
  In practice, only `'completed'` sessions are expected to be saved per the
  spec (a cancelled or errored session has no answer worth keeping in
  history), but the type does not forbid it so this is a documented caller
  responsibility, not a runtime-enforced one.
- `setFlag()` MUST be callable for any `id` returned by `list()`/`get()` and
  MUST be a no-op error (not a throw) if `id` does not exist, since the
  report action (User Story 4) can race with a user deleting the same
  session from another screen.

## Postconditions

- `delete(id)` removes the entry such that a subsequent `get(id)` returns
  `null` and the entry never reappears in `list()` — matches FR-018
  (deleted entries are not recoverable through the app).
- `clear()` leaves `list()` returning `[]` — matches the History screen's
  empty-state acceptance scenario (User Story 3).
- All writes go through MMKV directly; this module MUST NOT import
  `@react-native-async-storage/async-storage` or any SQLite binding
  (Principle VIII enforced structurally, same pattern as the network-call
  prohibition in the inference module).

## Phase 3 addendum (FR-041, FR-044–FR-046)

- A `QASession` now carries `pinnedExtraction: string | null` (data-model.md):
  the structured visual extraction produced on turn 1, pinned as un-evictable
  context for every later turn. `save()` MUST persist it verbatim; a follow-up
  save MUST carry forward the base session's `pinnedExtraction` unchanged.
- Sessions read back from storage that predate the field (Phase 1/2 records)
  MUST normalize `pinnedExtraction` to `null` rather than `undefined`, so
  callers can rely on the field's presence.
- A session IS the resumable chat-thread record (FR-045): `get(id)` returning
  a `'completed'` session with N turns is the sole hydration source for
  reopening that thread from history (FR-046) — there is no separate thread
  entity, and `save()` on a continued thread overwrites the same id with the
  appended `turns[]`.
