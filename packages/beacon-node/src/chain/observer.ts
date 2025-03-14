import {Logger} from "@lodestar/logger";
import {JobItemQueue} from "../util/queue/itemQueue.js";
import {ChainEvent, ChainEventEmitter, IChainEvents} from "./emitter.js";

export type CleanupHandler = () => void;

// We could have create such events handler dynamically using `ChainEvent`
// But the event name enums are not consistent, some are using `_` and some
// Are using `:` so why not easy to manipulate the names to create correct type
/**
 * A base class that defines optional chain-event handler methods.
 *
 * Concrete classes may choose to implement any subset of these methods
 * (`onCheckpoint`, `onForkChoiceJustified`, `onForkChoiceFinalized`).
 * The code dynamically checks if the method is implemented before calling it.
 */
export abstract class BaseObserver {
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
 * A chain observer that sits in the main process and observes various chain events.
 *
 * This class subscribes directly to a `ChainEventEmitter` and attaches any
 * implemented handler methods (`onCheckpoint`, etc). When subscribed, it binds those
 * methods to the emitter. When unsubscribed, it removes those bindings.
 */
export abstract class ChainObserver extends BaseObserver {
  protected cleanupHandlers: CleanupHandler[] = [];

  /**
   * Subscribes to the chain event emitter. For each implemented event handler
   * method (e.g. `onCheckpoint`), it adds a corresponding listener.
   */
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

  /**
   * Unsubscribe from all event listeners that were previously subscribed.
   * This calls each `cleanupHandler` once, removing them from the emitter.
   */
  unsubscribe(): void {
    for (const cleanupHandler of this.cleanupHandlers) {
      cleanupHandler();
    }
  }
}

/**
 * A `ChainObserver` variant that processes events via an internal queue.
 *
 * Instead of calling the event handlers immediately, it enqueues them
 * in a `JobItemQueue`. Items in this queue are processed one by one
 * (or in batches, if you adapt `JobItemQueue`). This is useful for ensuring
 * that event handling is sequential and does not block other operations.
 */
export abstract class QueueObserver extends ChainObserver {
  protected jobQueue: JobItemQueue<[HandlerNames, unknown[]], void>;

  /**
   * Constructs a `QueueObserver` with a maximum queue length and
   * an optional AbortSignal to terminate processing.
   */
  constructor({maxQueueLength, signal, logger}: {maxQueueLength: number; signal: AbortSignal; logger: Logger}) {
    super({logger});

    this.jobQueue = new JobItemQueue(
      async (handler, args) => {
        const eventHandler = this[handler];
        if (!eventHandler) return;

        try {
          // biome-ignore lint/suspicious/noExplicitAny: Can not use `unknown` type here because of union
          await eventHandler(...(args as any[]));
        } catch (err) {
          // We had to catch and log because we want to keep processing the rest of the events
          this.logger.error("Queue event caused error", {}, err as Error);
        }
      },
      {
        maxLength: maxQueueLength,
        signal,
      }
    );
  }

  /**
   * Subscribe to chain events but, instead of calling handlers immediately,
   * push them onto the queue for asynchronous/serialized processing.
   */
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
        this.logger.verbose("subscribing to chain event", {
          observer: this.constructor.name,
          event: handlersEventMap[handlerName],
        });
        emitter.addListener(handlersEventMap[handlerName], eventHandler);

        this.cleanupHandlers.push(() => {
          this.logger.verbose("unsubscribing from chain event", {
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

/**
 * A mediator that:
 *  - Subscribes to chain events exactly once (using a single event handler per event type).
 *  - Enqueues these events in a single `JobItemQueue`.
 *  - Dispatches each event at processing time to any registered observers that implement the corresponding method.
 *
 * This is useful when you want multiple observers to share the same queue,
 * so they are processed in a single sequential workflow instead of each observer
 * having its own queue.
 */
export class MediatorQueueObserver {
  protected logger: Logger;
  protected cleanupHandlers: CleanupHandler[] = [];
  protected observers: BaseObserver[] = [];
  protected jobQueue: JobItemQueue<[HandlerNames, unknown[]], void>;

  constructor({maxQueueLength, signal, logger}: {maxQueueLength: number; signal: AbortSignal; logger: Logger}) {
    this.logger = logger;

    // Single processor function
    // For each queue item, call all relevant observers that implement the method
    this.jobQueue = new JobItemQueue<[HandlerNames, unknown[]], void>(
      async (handlerName, eventArgs) => {
        for (const obs of this.observers) {
          const fn = obs[handlerName];
          if (!fn) continue;

          try {
            // biome-ignore lint/suspicious/noExplicitAny: we want to call the method with the correct args
            await fn.call(obs, ...(eventArgs as [any, any]));
          } catch (err) {
            // We had to catch and log because we want to keep processing the rest of the events
            this.logger.error("Queue event caused error", {}, err as Error);
          }
        }
      },
      {
        maxLength: maxQueueLength,
        maxConcurrency: 1,
        signal,
        // In earlier implementation we were only processing `onFinalizedCheckpoint` in the queue
        // and not the `onCheckpoint` event. In current implementation we are processing all events
        // in queue. So tests are fail with ERROR_QUEUE_ABORT as there are a lot of checkpoints jobs
        // pending during the tests. So we set this option to drop all jobs on abort
        dropAllJobOnAbort: true,
      }
    );
  }

  /**
   * Adds an observer to the mediator. The mediator will attempt to call
   * any relevant `onXyz` method on this observer whenever a queued event is processed.
   */
  registerObserver(observer: BaseObserver): void {
    if (!this.observers.includes(observer)) {
      this.observers.push(observer);
    }
  }

  /**
   * Subscribes to the `ChainEventEmitter` exactly once for each known event type.
   * When a chain event fires, we push `[handlerName, args]` to the job queue.
   */
  subscribe(emitter: ChainEventEmitter, signal?: AbortSignal): void {
    for (const handlerName of handlerNames) {
      // figure out the actual chain event, e.g. "checkpoint"
      const chainEvent = handlersEventMap[handlerName];
      this.logger.verbose("MediatorQueueObserver: subscribing to chain event", {chainEvent});

      const listener = (...args: unknown[]) => {
        this.logger.verbose("MediatorQueueObserver: event -> queue push", {
          event: chainEvent,
          handlerName,
        });
        this.jobQueue.push(handlerName, args);
      };

      emitter.addListener(chainEvent, listener);
      this.cleanupHandlers.push(() => {
        emitter.removeListener(chainEvent, listener);
      });
    }

    if (signal) {
      signal.addEventListener("abort", () => this.unsubscribe(), {once: true});
    }
  }

  /**
   * Unsubscribe from all chain events by running each stored cleanup handler.
   * This stops the mediator from pushing new events to the queue.
   */
  unsubscribe(): void {
    for (const cleanup of this.cleanupHandlers) {
      cleanup();
    }
    this.cleanupHandlers = [];
  }
}
