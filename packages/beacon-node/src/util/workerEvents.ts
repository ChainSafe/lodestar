import {MessagePort, Worker} from "node:worker_threads";
import {Thread} from "@chainsafe/threads";
import {Logger} from "@lodestar/logger";
import {sleep} from "@lodestar/utils";
import {StrictEventEmitterSingleArg} from "./strictEvents.js";

export type WorkerBridgeEvent<EventData> = {
  type: string;
  event: keyof EventData;
  data: EventData[keyof EventData];
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
export function wireEventsOnWorkerThread<EventData>(
  mainEventName: string,
  events: StrictEventEmitterSingleArg<EventData>,
  parentPort: MessagePort,
  isWorkerToMain: {[K in keyof EventData]: EventDirection}
): void {
  // Subscribe to events from main thread
  parentPort.on("message", (data: WorkerBridgeEvent<EventData>) => {
    if (
      typeof data === "object" &&
      data.type === mainEventName &&
      // This check is not necessary but added for safety in case of improper implemented events
      isWorkerToMain[data.event] === EventDirection.mainToWorker
    ) {
      events.emit(data.event, data.data);
    }
  });

  for (const eventName of Object.keys(isWorkerToMain) as (keyof EventData)[]) {
    if (isWorkerToMain[eventName] === EventDirection.workerToMain) {
      // Pick one of the events to comply with StrictEventEmitter function signature
      events.on(eventName, (data) => {
        const workerEvent: WorkerBridgeEvent<EventData> = {
          type: mainEventName,
          event: eventName,
          data,
        };
        parentPort.postMessage(workerEvent);
      });
    }
  }
}

export function wireEventsOnMainThread<EventData>(
  mainEventName: string,
  events: StrictEventEmitterSingleArg<EventData>,
  worker: Pick<Worker, "on" | "postMessage">,
  isWorkerToMain: {[K in keyof EventData]: EventDirection}
): void {
  // Subscribe to events from main thread
  worker.on("message", (data: WorkerBridgeEvent<EventData>) => {
    if (
      typeof data === "object" &&
      data.type === mainEventName &&
      // This check is not necessary but added for safety in case of improper implemented events
      isWorkerToMain[data.event] === EventDirection.workerToMain
    ) {
      events.emit(data.event, data.data);
    }
  });

  for (const eventName of Object.keys(isWorkerToMain) as (keyof EventData)[]) {
    if (isWorkerToMain[eventName] === EventDirection.mainToWorker) {
      // Pick one of the events to comply with StrictEventEmitter function signature
      events.on(eventName, (data) => {
        const workerEvent: WorkerBridgeEvent<EventData> = {
          type: mainEventName,
          event: eventName,
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
