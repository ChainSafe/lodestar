import {CheckpointWithHex} from "@lodestar/fork-choice";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {phase0} from "@lodestar/types";
import {ChainEvent, ChainEventEmitter, IChainEvents} from "./chain/emitter.js";
import {JobItemQueue} from "./util/queue/itemQueue.js";

export type CleanupHandler = () => void;

// We could have create such events handler dynamically using `ChainEvent`
// But the event name enums are not consistent, some are using `_` and some
// Are using `:` so why not easy to manipulate the names to create correct type
abstract class ObserverHandlers {
  onCheckpoint?: IChainEvents[ChainEvent.checkpoint];
  onForkChoiceJustified?: IChainEvents[ChainEvent.forkChoiceJustified];
  onForkChoiceFinalized?: IChainEvents[ChainEvent.forkChoiceFinalized];
}

const handlersEventMap = {
  onCheckpoint: ChainEvent.checkpoint,
  onForkChoiceJustified: ChainEvent.forkChoiceJustified,
  onForkChoiceFinalized: ChainEvent.forkChoiceFinalized,
} as const;
const handlerNames = Object.keys(handlersEventMap) as (keyof typeof handlersEventMap)[];
type HandlerNames = keyof typeof handlersEventMap;

/**
 * A chain observer sits in the main process and observe various chain events
 */
export abstract class ChainObserver extends ObserverHandlers {
  protected cleanupHandlers: CleanupHandler[] = [];

  subscribe(emitter: ChainEventEmitter, signal?: AbortSignal): void {
    for (const handlerName of handlerNames) {
      const handler = this[handlerName];
      if (handler) {
        const boundedHandler = handler.bind(this);
        emitter.addListener(handlersEventMap[handlerName], boundedHandler);

        this.cleanupHandlers.push(() => {
          emitter.removeListener(handlersEventMap[handlerName], boundedHandler);
        });
      }
    }

    if (signal) {
      signal.addEventListener("abort", () => this.unsubscribe());
    }
  }

  unsubscribe(): void {
    for (const handler of this.cleanupHandlers) {
      handler();
    }
  }
}

/**
 * The queue observer push the events to a queue and then process those one by one from the queue
 */
export abstract class QueueObserver extends ChainObserver {
  protected jobQueue: JobItemQueue<[HandlerNames, unknown[]], void>;

  constructor({maxQueueLength, signal}: {maxQueueLength: number; signal: AbortSignal}) {
    super();
    this.jobQueue = new JobItemQueue(
      async (handler, args) => {
        const eventHandler = this[handler];
        // biome-ignore lint/suspicious/noExplicitAny:
        if (eventHandler) await eventHandler(...(args as [any, any]));
      },
      {
        maxLength: maxQueueLength,
        signal,
      }
    );
  }

  subscribe(emitter: ChainEventEmitter, signal?: AbortSignal): void {
    for (const handler of handlerNames) {
      if (this[handler]) {
        const eventHandler = (...args: unknown[]) => {
          this.jobQueue.push(handler, args);
        };
        emitter.addListener(handlersEventMap[handler], eventHandler);

        this.cleanupHandlers.push(() => {
          emitter.removeListener(handlersEventMap[handler], eventHandler);
        });
      }
    }

    if (signal) {
      signal.addEventListener("abort", () => this.unsubscribe());
    }
  }
}
