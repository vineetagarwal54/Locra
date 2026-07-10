import { assign, fromPromise, setup } from 'xstate';

import type { HiddenVisualEvidence } from './OutputPipelineTypes';

export interface TurnLifecycleRequest {
  requestId: string;
  conversationId: string;
  originatingUserMessageId: string;
  assistantMessageId: string;
  question: string;
  imagePath: string | null;
}

export interface TurnLifecycleContext {
  request: TurnLifecycleRequest | null;
  streamedResponse: string;
  hiddenEvidence: HiddenVisualEvidence | null;
  pinnedExtraction: string | null;
  errorMessage: string | null;
}

export type TurnLifecycleEvent =
  | { type: 'SUBMIT'; request: TurnLifecycleRequest }
  | { type: 'TOKEN'; response: string; count: number }
  | { type: 'CANCEL' }
  | { type: 'RETRY' };

export interface PerceptionOutput {
  hiddenEvidence: HiddenVisualEvidence | null;
  pinnedExtraction: string | null;
}

export interface StreamOutput {
  response: string;
  tokenCount: number;
}

const initialContext: TurnLifecycleContext = {
  request: null,
  streamedResponse: '',
  hiddenEvidence: null,
  pinnedExtraction: null,
  errorMessage: null,
};

export const turnLifecycleMachine = setup({
  types: {
    context: {} as TurnLifecycleContext,
    events: {} as TurnLifecycleEvent,
  },
  actors: {
    prepareTurn: fromPromise(async (): Promise<undefined> => undefined),
    runPerception: fromPromise(async (): Promise<PerceptionOutput> => ({
      hiddenEvidence: null,
      pinnedExtraction: null,
    })),
    assembleContext: fromPromise(async (): Promise<undefined> => undefined),
    loadModel: fromPromise(async (): Promise<undefined> => undefined),
    streamAnswer: fromPromise(async (): Promise<StreamOutput> => ({
      response: '',
      tokenCount: 0,
    })),
  },
  actions: {
    acceptSubmit: assign(({ event }) => {
      if (event.type !== 'SUBMIT') {
        return {};
      }

      return {
        request: event.request,
        streamedResponse: '',
        hiddenEvidence: null,
        pinnedExtraction: null,
        errorMessage: null,
      };
    }),
    assignPerception: assign(({ event }) => {
      if (!('output' in event)) {
        return {};
      }
      const output = event.output as PerceptionOutput;
      return {
        hiddenEvidence: output.hiddenEvidence,
        pinnedExtraction: output.pinnedExtraction,
      };
    }),
    assignStreamedResponse: assign(({ event }) => {
      if (event.type !== 'TOKEN') {
        return {};
      }

      return {
        streamedResponse: event.response,
      };
    }),
    assignStreamOutput: assign(({ event }) => {
      if (!('output' in event)) {
        return {};
      }
      const output = event.output as StreamOutput;
      return {
        streamedResponse: output.response,
      };
    }),
    assignFailure: assign(({ event }) => ({
      errorMessage: 'error' in event && event.error instanceof Error
        ? event.error.message
        : 'Inference failed for an unknown reason.',
    })),
    prepareRetry: assign(({ context }) => {
      if (context.request === null) {
        return {};
      }

      return {
        request: {
          ...context.request,
          requestId: `${context.request.requestId}:retry`,
        },
        streamedResponse: '',
        hiddenEvidence: null,
        pinnedExtraction: null,
        errorMessage: null,
      };
    }),
  },
}).createMachine({
  id: 'turnLifecycle',
  initial: 'idle',
  context: initialContext,
  states: {
    idle: {
      on: {
        SUBMIT: {
          target: 'preparing',
          actions: 'acceptSubmit',
        },
      },
    },
    preparing: {
      invoke: {
        src: 'prepareTurn',
        onDone: [
          {
            target: 'perception',
            guard: ({ context }) => context.request?.imagePath !== null,
          },
          { target: 'contextAssembly' },
        ],
        onError: {
          target: 'failed',
          actions: 'assignFailure',
        },
      },
      on: {
        CANCEL: 'interrupted',
      },
    },
    perception: {
      invoke: {
        src: 'runPerception',
        onDone: {
          target: 'contextAssembly',
          actions: 'assignPerception',
        },
        onError: {
          target: 'failed',
          actions: 'assignFailure',
        },
      },
      on: {
        CANCEL: 'interrupted',
      },
    },
    contextAssembly: {
      invoke: {
        src: 'assembleContext',
        onDone: {
          target: 'generating',
        },
        onError: {
          target: 'failed',
          actions: 'assignFailure',
        },
      },
      on: {
        CANCEL: 'interrupted',
      },
    },
    generating: {
      invoke: {
        src: 'loadModel',
        onDone: {
          target: 'streaming',
        },
        onError: {
          target: 'failed',
          actions: 'assignFailure',
        },
      },
      on: {
        CANCEL: 'interrupted',
      },
    },
    streaming: {
      invoke: {
        src: 'streamAnswer',
        onDone: {
          target: 'completed',
          actions: 'assignStreamOutput',
        },
        onError: {
          target: 'failed',
          actions: 'assignFailure',
        },
      },
      on: {
        TOKEN: {
          actions: 'assignStreamedResponse',
        },
        CANCEL: 'interrupted',
      },
    },
    completed: {
      on: {
        SUBMIT: {
          target: 'preparing',
          actions: 'acceptSubmit',
        },
      },
    },
    failed: {
      on: {
        SUBMIT: {
          target: 'preparing',
          actions: 'acceptSubmit',
        },
        RETRY: {
          target: 'preparing',
          actions: 'prepareRetry',
          guard: ({ context }) => context.request !== null,
        },
      },
    },
    interrupted: {
      on: {
        SUBMIT: {
          target: 'preparing',
          actions: 'acceptSubmit',
        },
      },
    },
  },
});
