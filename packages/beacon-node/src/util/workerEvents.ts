import {MessagePort, Worker} from "node:worker_threads";
import {Thread} from "@chainsafe/threads";
import {Logger} from "@lodestar/logger";
import {sleep} from "@lodestar/utils";
import {Metrics} from "../metrics/metrics.js";
import {NetworkCoreWorkerMetrics} from "../network/core/metrics.js";
import {StrictEventEmitterSingleArg} from "./strictEvents.js";
import {EmittedAt} from "./types.js";

type EventData = {[key: string]: EmittedAt};

export type WorkerBridgeEvent<E extends EventData> = {
  type: string;
  event: keyof E;
  posted: number;
  data: E[keyof E];
};

export enum EventDirection {
  workerToMain,
  mainToWorker,
  /** Event not emitted through worker boundary */
  none,
}

/**
 * Bridges events from worker to main thread
 * Each event can only have one direction:
 * - worker to main
 * - main to worker
 */
export function wireEventsOnWorkerThread<E extends EventData>(
  mainEventName: string,
  events: StrictEventEmitterSingleArg<E>,
  parentPort: MessagePort,
  metrics: NetworkCoreWorkerMetrics | null,
  isWorkerToMain: {[K in keyof E]: EventDirection}
): void {
  // Subscribe to events from main thread
  parentPort.on("message", (data: WorkerBridgeEvent<E>) => {
    if (
      typeof data === "object" &&
      data.type === mainEventName &&
      // This check is not necessary but added for safety in case of improper implemented events
      isWorkerToMain[data.event] === EventDirection.mainToWorker
    ) {
      const emitted = Date.now();
      events.emit(data.event, data.data);
      metrics?.networkWorkerWireEventsOnWorkerThreadPortLatency.observe(emitted - data.posted);
      metrics?.networkWorkerWireEventsOnWorkerThreadEventLatency.observe(emitted - data.data.emittedAt);
    }
  });

  for (const eventName of Object.keys(isWorkerToMain) as (keyof EventData)[]) {
    if (isWorkerToMain[eventName] === EventDirection.workerToMain) {
      // Pick one of the events to comply with StrictEventEmitter function signature
      events.on(eventName, (data) => {
        const workerEvent: WorkerBridgeEvent<EventData> = {
          type: mainEventName,
          event: eventName,
          posted: Date.now(),
          data,
        };
        parentPort.postMessage(workerEvent);
      });
    }
  }
}

export function wireEventsOnMainThread<E extends EventData>(
  mainEventName: string,
  events: StrictEventEmitterSingleArg<E>,
  worker: Pick<Worker, "on" | "postMessage">,
  metrics: Metrics | null,
  isWorkerToMain: {[K in keyof E]: EventDirection}
): void {
  // Subscribe to events from main thread
  worker.on("message", (data: WorkerBridgeEvent<E>) => {
    if (
      typeof data === "object" &&
      data.type === mainEventName &&
      // This check is not necessary but added for safety in case of improper implemented events
      isWorkerToMain[data.event] === EventDirection.workerToMain
    ) {
      const emitted = Date.now();
      events.emit(data.event, data.data);
      metrics?.networkWorkerWireEventsOnMainThreadPortLatency.observe(emitted - data.posted);
      metrics?.networkWorkerWireEventsOnMainThreadEventLatency.observe(emitted - data.data.emittedAt);
    }
  });

  for (const eventName of Object.keys(isWorkerToMain) as (keyof E)[]) {
    if (isWorkerToMain[eventName] === EventDirection.mainToWorker) {
      // Pick one of the events to comply with StrictEventEmitter function signature
      events.on(eventName, (data) => {
        const workerEvent: WorkerBridgeEvent<E> = {
          type: mainEventName,
          event: eventName,
          posted: Date.now(),
          data,
        };
        worker.postMessage(workerEvent);
      });
    }
  }
}

export async function terminateWorkerThread({
  worker,
  retryMs,
  retryCount,
  logger,
}: {
  worker: Thread;
  retryMs: number;
  retryCount: number;
  logger?: Logger;
}): Promise<void> {
  const terminated = new Promise((resolve) => {
    Thread.events(worker).subscribe((event) => {
      if (event.type === "termination") {
        resolve(true);
      }
    });
  });

  for (let i = 0; i < retryCount; i++) {
    await Thread.terminate(worker);
    const result = await Promise.race([terminated, sleep(retryMs).then(() => false)]);

    if (result) return;

    logger?.warn("Worker thread failed to terminate, retrying...");
  }

  throw new Error(`Worker thread failed to terminate in ${retryCount * retryMs}ms.`);
}
