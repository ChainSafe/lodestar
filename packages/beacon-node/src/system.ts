import {Logger} from "@lodestar/logger";
import {ChainEvent, ChainEventEmitter, IChainEvents} from "./chain/emitter.js";
import {JobItemQueue} from "./util/queue/itemQueue.js";

export type CleanupHandler = () => void;

// We could have create such events handler dynamically using `ChainEvent`
// But the event name enums are not consistent, some are using `_` and some
// Are using `:` so why not easy to manipulate the names to create correct type
abstract class ObserverHandlers {
  protected logger: Logger;
  constructor({logger}: {logger: Logger}) {
    this.logger = logger;
  }

  onCheckpoint?(
    ...args: Parameters<IChainEvents[ChainEvent.checkpoint]>
  ): ReturnType<IChainEvents[ChainEvent.checkpoint]>;
  onForkChoiceJustified?(
    ...args: Parameters<IChainEvents[ChainEvent.forkChoiceJustified]>
  ): ReturnType<IChainEvents[ChainEvent.forkChoiceJustified]>;
  onForkChoiceFinalized?(
    ...args: Parameters<IChainEvents[ChainEvent.forkChoiceFinalized]>
  ): ReturnType<IChainEvents[ChainEvent.forkChoiceFinalized]>;
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
        this.logger.verbose("subscribing chain event", {
          observer: this.constructor.name,
          event: handlersEventMap[handlerName],
        });

        const boundedHandler = handler.bind(this);
        emitter.addListener(handlersEventMap[handlerName], boundedHandler);

        this.cleanupHandlers.push(() => {
          this.logger.verbose("unsubscribing chain event", {
            observer: this.constructor.name,
            event: handlersEventMap[handlerName],
          });
          emitter.removeListener(handlersEventMap[handlerName], boundedHandler);
        });
      }
    }

    if (signal) {
      signal.addEventListener("abort", () => this.unsubscribe(), {once: true});
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

  constructor({maxQueueLength, signal, logger}: {maxQueueLength: number; signal: AbortSignal; logger: Logger}) {
    super({logger});

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
    for (const handlerName of handlerNames) {
      if (this[handlerName]) {
        const eventHandler = (...args: unknown[]) => {
          this.logger.verbose("pushing event to queue", {
            observer: this.constructor.name,
            event: handlersEventMap[handlerName],
          });
          this.jobQueue.push(handlerName, args);
        };
        this.logger.verbose("subscribing chain event", {
          observer: this.constructor.name,
          event: handlersEventMap[handlerName],
        });
        emitter.addListener(handlersEventMap[handlerName], eventHandler);

        this.cleanupHandlers.push(() => {
          this.logger.verbose("unsubscribing chain event", {
            observer: this.constructor.name,
            event: handlersEventMap[handlerName],
          });
          emitter.removeListener(handlersEventMap[handlerName], eventHandler);
        });
      }
    }

    if (signal) {
      signal.addEventListener("abort", () => this.unsubscribe());
    }
  }
}
