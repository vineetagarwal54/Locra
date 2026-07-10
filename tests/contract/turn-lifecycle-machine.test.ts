import { readFileSync } from 'fs';
import { join } from 'path';

import { createActor, fromPromise } from 'xstate';

import {
  turnLifecycleMachine,
  type PerceptionOutput,
  type StreamOutput,
  type TurnLifecycleContext,
  type TurnLifecycleRequest,
} from '../../src/inference/turnLifecycleMachine';

function makeRequest(overrides: Partial<TurnLifecycleRequest> = {}): TurnLifecycleRequest {
  return {
    requestId: 'request-1',
    conversationId: 'conversation-1',
    originatingUserMessageId: 'user-message-1',
    assistantMessageId: 'assistant-message-1',
    question: 'What is in this image?',
    imagePath: '/tmp/image.jpg',
    ...overrides,
  };
}

function machineWithActors(overrides: Parameters<typeof turnLifecycleMachine.provide>[0] = {}) {
  return turnLifecycleMachine.provide({
    actors: {
      prepareTurn: fromPromise(async (): Promise<undefined> => undefined),
      runPerception: fromPromise(async (): Promise<PerceptionOutput> => ({
        hiddenEvidence: null,
        pinnedExtraction: null,
      })),
      assembleContext: fromPromise(async (): Promise<undefined> => undefined),
      loadModel: fromPromise(async (): Promise<undefined> => undefined),
      streamAnswer: fromPromise(async (): Promise<StreamOutput> => ({
        response: 'A concise answer.',
        tokenCount: 4,
      })),
      ...overrides.actors,
    },
  });
}

function waitForState(actor: ReturnType<typeof createActor>, state: string): Promise<void> {
  if (actor.getSnapshot().matches(state)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error(`Timed out waiting for ${state}; current=${String(actor.getSnapshot().value)}`));
    }, 1000);

    const subscription = actor.subscribe((snapshot) => {
      if (snapshot.matches(state)) {
        clearTimeout(timeout);
        subscription.unsubscribe();
        resolve();
      }
    });
  });
}

describe('turnLifecycleMachine contract', () => {
  it('allows the valid image-turn lifecycle and reaches exactly one terminal state', async () => {
    const states: string[] = [];
    const actor = createActor(machineWithActors());
    actor.subscribe((snapshot) => {
      states.push(String(snapshot.value));
    });
    actor.start();

    actor.send({ type: 'SUBMIT', request: makeRequest() });
    await waitForState(actor, 'completed');

    expect(states).toEqual(
      expect.arrayContaining([
        'idle',
        'preparing',
        'perception',
        'contextAssembly',
        'generating',
        'streaming',
        'completed',
      ]),
    );
    expect(actor.getSnapshot().matches('failed')).toBe(false);
    expect(actor.getSnapshot().matches('interrupted')).toBe(false);
  });

  it('rejects SUBMIT while non-idle without replacing the owning request', async () => {
    let releasePrepare!: () => void;
    const actor = createActor(machineWithActors({
      actors: {
        prepareTurn: fromPromise(
          () => new Promise<undefined>((resolve) => {
            releasePrepare = () => resolve(undefined);
          }),
        ),
      },
    }));
    actor.start();

    const original = makeRequest();
    const competing = makeRequest({
      requestId: 'request-2',
      conversationId: 'conversation-2',
      originatingUserMessageId: 'user-message-2',
      assistantMessageId: 'assistant-message-2',
    });

    actor.send({ type: 'SUBMIT', request: original });
    await waitForState(actor, 'preparing');
    actor.send({ type: 'SUBMIT', request: competing });

    expect(actor.getSnapshot().context.request).toEqual(original);

    releasePrepare();
    await waitForState(actor, 'completed');
  });

  it('retries a failed request with the same conversation and message identities', async () => {
    const actor = createActor(machineWithActors({
      actors: {
        streamAnswer: fromPromise(async (): Promise<StreamOutput> => {
          throw new Error('model failed');
        }),
      },
    }));
    actor.start();

    const original = makeRequest();
    actor.send({ type: 'SUBMIT', request: original });
    await waitForState(actor, 'failed');

    actor.send({ type: 'RETRY' });
    await waitForState(actor, 'preparing');

    const retried = actor.getSnapshot().context.request;
    expect(retried).toEqual(
      expect.objectContaining({
        conversationId: original.conversationId,
        originatingUserMessageId: original.originatingUserMessageId,
        assistantMessageId: original.assistantMessageId,
        question: original.question,
        imagePath: original.imagePath,
      }),
    );
    expect(retried?.requestId).not.toBe(original.requestId);
  });

  it('can reach failed and interrupted terminal states without exposing another terminal state', async () => {
    const failedActor = createActor(machineWithActors({
      actors: {
        streamAnswer: fromPromise(async (): Promise<StreamOutput> => {
          throw new Error('model failed');
        }),
      },
    }));
    failedActor.start();
    failedActor.send({ type: 'SUBMIT', request: makeRequest() });
    await waitForState(failedActor, 'failed');
    expect(failedActor.getSnapshot().matches('completed')).toBe(false);
    expect(failedActor.getSnapshot().matches('interrupted')).toBe(false);

    let releasePrepare!: () => void;
    const interruptedActor = createActor(machineWithActors({
      actors: {
        prepareTurn: fromPromise(
          () => new Promise<undefined>((resolve) => {
            releasePrepare = () => resolve(undefined);
          }),
        ),
      },
    }));
    interruptedActor.start();
    interruptedActor.send({ type: 'SUBMIT', request: makeRequest() });
    await waitForState(interruptedActor, 'preparing');
    interruptedActor.send({ type: 'CANCEL' });
    releasePrepare();

    expect(interruptedActor.getSnapshot().matches('interrupted')).toBe(true);
    expect(interruptedActor.getSnapshot().matches('completed')).toBe(false);
    expect(interruptedActor.getSnapshot().matches('failed')).toBe(false);
  });

  it('keeps only transient turn fields in machine context and imports no persistence layer', () => {
    const contextKeys = Object.keys(turnLifecycleMachine.config.context as TurnLifecycleContext).sort();
    expect(contextKeys).toEqual([
      'errorMessage',
      'hiddenEvidence',
      'pinnedExtraction',
      'request',
      'streamedResponse',
    ]);

    const source = readFileSync(
      join(process.cwd(), 'src/inference/turnLifecycleMachine.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/ConversationMessage\[\]|messages\W*:/);
    expect(source).not.toMatch(/from ['"].*storage\/mmkv['"]/);
    expect(source).not.toMatch(/from ['"].*history\/HistoryStore['"]/);
    expect(source).not.toMatch(/MMKV|AsyncStorage|SQLite/);
  });
});
