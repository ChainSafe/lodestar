import {ModuleThread} from "@chainsafe/threads";
import {ChainEventEmitter} from "./chain/emitter.js";
import {Metrics} from "./metrics/metrics.js";
import {JobItemQueue} from "./util/queue/itemQueue.js";

/**
 * A service is a component of the system which resides in the
 * main process and listen to the specific events in the system
 */
export interface LodestarObserver {
  subscribe(emitter: ChainEventEmitter): void;
  unsubscribe(emitter: ChainEventEmitter): void;
}

/**
 * A queue service is a component of the system which resides in the
 * main process, listens to events and process those via queue
 */
export abstract class LodestarQueueObserver<QParams extends unknown[], QReturn> {
  abstract subscribe(emitter: ChainEventEmitter): void;
  abstract unsubscribe(emitter: ChainEventEmitter): void;

  protected abstract processQueueItem(...args: QParams): Promise<QReturn>;
  protected jobQueue: JobItemQueue<QParams, QReturn>;
  protected metrics: Metrics | null;

  constructor({
    maxQueueLength,
    signal,
    metrics,
  }: {maxQueueLength: number; signal: AbortSignal; metrics: Metrics | null}) {
    this.metrics = metrics;
    this.jobQueue = new JobItemQueue<QParams, QReturn>(this.processQueueItem.bind(this), {
      maxLength: maxQueueLength,
      signal,
    });
  }

  processLater(...params: QParams): void {
    this.jobQueue.push(...params);
  }
}

/**
 * A worker is any component of the system which loads in the the worker thread
 * */
export type LodestarServiceWorker<
  T extends {
    // biome-ignore lint/suspicious/noExplicitAny:
    [methodName: string]: (...args: any[]) => any;
  },
> = T & {close(): Promise<void>; scrapeMetrics(): Promise<string>};

/**
 * A worker proxy is component of system which resides in main process and communicate
 * to the underlying worker or queue of workers
 */
export type LodestarService<T> = ModuleThread<
  T & {
    close(): Promise<void>;
    scrapeMetrics(): Promise<string>;
  }
>;
