# Contract: Turn Lifecycle Machine (XState v5, internal to `InferenceQueue`)

Documents the internal contract for research.md R10's XState v5 adoption. This is **internal** to `src/inference/InferenceQueue.ts` — nothing outside that file imports `xstate` directly, per the "Zustand remains the only UI-facing reactive layer" rule. `contracts/conversation-store.md`'s `IInferenceQueue` contract (unchanged in method signatures) is what every other module actually depends on.

## Why this contract exists separately

The task brief was explicit that XState must not become conversation storage, context memory, or persistence, and that its scope is narrow (turn/inference lifecycle only). Rather than leaving that as a prose promise, this contract states it as invariants the implementation must satisfy — the same way `contracts/conversation-store.md` and `contracts/inference-ownership.md` do for the rest of this feature.

## Public surface (internal to `InferenceQueue.ts` only)

```ts
// src/inference/turnLifecycleMachine.ts — new file, research.md R10
import { setup, fromPromise, fromCallback } from 'xstate';

interface TurnLifecycleContext {
  request: {
    requestId: string;                 // minted fresh per SUBMIT/RETRY; correlates InferenceTrace entries
    conversationId: string;
    originatingUserMessageId: string;  // stable id of the user message being answered
    assistantMessageId: string;        // stable id of the assistant message being generated into
    question: string;
    imagePath: string | null;
  } | null;
  streamedResponse: string;
  hiddenEvidence: HiddenVisualEvidence | null;   // transient only — see data-model.md TurnLifecycleSnapshot
  pinnedExtraction: string | null;               // transient only — see data-model.md TurnLifecycleSnapshot
  errorMessage: string | null;
}

type TurnLifecycleEvent =
  | { type: 'SUBMIT'; request: TurnLifecycleContext['request'] }
  | { type: 'TOKEN'; response: string; count: number }   // internal, sent by the streaming fromCallback actor
  | { type: 'CANCEL' }
  | { type: 'RETRY' };

export const turnLifecycleMachine = setup({ /* actors: perception, contextAssembly, generation (fromPromise/fromCallback) */ })
  .createMachine({ /* states table — see research.md R10 */ });
```

There is deliberately no `turnIndex` field anywhere in `TurnLifecycleContext`. The three stable identities (`conversationId`, `originatingUserMessageId`, `assistantMessageId`) are what `RETRY` reuses unchanged and what every ownership-adjacent invariant below keys on — see `contracts/conversation-store.md`'s note on why a positional index is ambiguous the moment retry or multi-conversation attribution is in play.

`InferenceQueue` constructs exactly one `createActor(turnLifecycleMachine).start()` for its own lifetime (mirroring today's singleton class instance) and translates its snapshots into the existing `InferenceState` shape inside `IInferenceQueue.subscribe()` — no caller-visible change.

## Invariants this contract enforces (test-verifiable, behavioral)

These are intentionally framed at the behavioral level so the machine's internal structure can be safely refactored without breaking the contract — see the parallel note in `tasks.md`'s Phase 2 test task about not pinning exact import structure, actor count, or snapshot sequences.

1. **No storage**: `TurnLifecycleContext` has no field that can hold a `Conversation`, a `ConversationMessage[]` array, or any MMKV key/value — verified by asserting the context type's field list matches exactly the table above (a structural test, in the spirit of `history-store.test.ts`'s existing structural-boundary assertions). The machine never becomes the canonical conversation store; `conversationStore`/`HistoryStore` remain exclusively responsible for that (data-model.md).
2. **No persistence**: the machine module (`turnLifecycleMachine.ts`) never imports `src/storage/mmkv.ts` or `src/history/HistoryStore.ts` — same structural-assertion pattern as the existing `HistoryStore.ts`/`InferenceQueue.ts` boundary tests.
3. **Single instance, app-wide, valid transitions only**: `InferenceQueue` creates the actor exactly once per process lifetime (or once per `InferenceQueue` instance in tests); a `SUBMIT` while the machine is not `idle` is rejected the same way `isInFlight()` rejects today (contracts/conversation-store.md invariant 1's single-flight guarantee is unaffected by this internal refactor); the machine only ever reaches `completed`, `failed`, or `interrupted` as mutually exclusive terminal states from `streaming`/`generating`.
4. **Behavior-preserving for the existing camera-first flow** (research.md R9/R11 step 2/3): with `vision-once-chat-flow.test.ts` unmodified, the machine-backed `InferenceQueue` produces the same observable `InferenceState.status` progression that the pre-XState implementation did, for the existing turn-1-image scenario. This is verified at the level of "the same sequence of collapsed status values occurs," not "the exact token-by-token internal snapshot is byte-identical" — the latter would make safe internal refactoring impossible.
5. **Retry reuses identity, never new input**: `RETRY` sent while `state === 'failed'` transitions using `context.request` unchanged from the original `SUBMIT` — a test asserting `context.request.conversationId`, `.originatingUserMessageId`, and `.assistantMessageId` are identical before and after a `RETRY` transition (with only `requestId` allowed to change) is how FR-029 ("no duplicate user message, same logical assistant message regenerated") is verified at this layer.
6. **Frozen prompt-construction functions**: `ExtractionPrompt.ts`, `AnswerPrompt.ts`, `SystemPrompt.ts`, `ExtractionParser.ts` are called from invoked actors (`fromPromise`) with no wrapper logic that alters their inputs or outputs.

## Non-goals (explicit)

- No `@xstate/react` — no component, hook, or screen imports from `xstate` or `@xstate/react`.
- No per-conversation machine instances — conversation attribution is `conversationStore`'s job (R1), not the machine's.
- No new state beyond what `motion.md` §11.3 and the task brief's own vocabulary require — `perception` and `contextAssembly` are the only genuinely new (previously-implicit) states; everything else is a rename of an existing `InferenceStatus` value.
- No positional turn/message indexing anywhere in this machine's context or events — see the identity fields above.
