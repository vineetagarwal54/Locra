# Contract: Runtime Model Selection

1. Bootstrap reads the existing MMKV key. Missing/invalid data yields no selection.
2. A valid developer override supersedes the persisted value without becoming the normal flow.
3. Missing selection routes to `ModelSelection`; selection persists before setup begins.
4. Lifecycle initialization accepts one descriptor and matches only its expected filename.
5. The inference host receives one selected descriptor and contains the only `useLLM` call.
6. Switch requests fail while inference is active or download is downloading/paused.
7. A switch is committed only after the pending state has removed the current host.
8. Reconciliation of verified target files marks ready; subsequent download start is a no-op.
9. Files associated with the non-selected descriptor are ignored and never deleted by switching.
