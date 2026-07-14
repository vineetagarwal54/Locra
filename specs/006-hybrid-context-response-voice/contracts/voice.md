# Contract: Offline Voice Input

**Module**: `src/voice/` | Consumers: `ChatComposer` (UI), `store/conversationStore.ts` (drafts)

Voice is fully on-device, explicit opt-in, and gated by the approved voice runtime/model manifest (research R9). Voice model state is small and may live in MMKV; transcripts reuse the existing editable draft (no committed message until Send).

## VoiceModelLifecycle  ⛔ gated by approved voice manifest

```ts
enable(): Promise<void>;                 // user-explicit; only then may download begin (SC-012/015)
getState(): VoiceModelState;             // enabled/download/verify/permission/error
requestMicPermission(): Promise<boolean>;
```

- Before first use: show storage requirement, request mic permission at the right time, download + integrity-verify locally, support retry/recovery from an interrupted download (FR-042/043). Failure leaves the current draft and conversation intact.

## VoiceRecordingService / VoiceTranscriptionService  ⛔ gated

```ts
startRecording(): Promise<void>;         // acquires DeviceResourcePolicy (record)
stopAndTranscribe(): Promise<string>;    // fully on-device; returns text
cancel(): void;                          // clean release of lease + native context
```

## Flow invariants

- Transcription runs fully on-device with the device offline (FR-042, SC-012/015).
- The transcript lands in the editable composer draft and **MUST NEVER** auto-submit — Send is always an explicit user action (FR-044). Empty/unintelligible ⇒ editable (possibly empty) text, no submit.
- On submit, voice text flows through the **identical** typed-input path (`conversationStore.submit`) — same SQL/context/retrieval/summary/response-mode/Qwen pipeline; no separate answer path (FR-044/046).

## DeviceResourcePolicy (shared single-flight gate)

```ts
acquire(kind: 'qwen-answer' | 'qwen-compaction' | 'embedding' | 'record' | 'transcribe'): Promise<Lease>;
```

- Exactly one protected operation at a time (FR-045, SC-012): starting recording while another protected op is active is blocked with a clear status; protected ops cannot begin while recording is active. Every path releases the lease on success, cancel, and failure. If the device spike requires it, heavy Qwen/embedding context is unloaded before transcription.
