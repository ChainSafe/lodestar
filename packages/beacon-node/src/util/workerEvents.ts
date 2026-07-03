import {MessagePort, Worker} from "node:worker_threads";
import type {Message} from "@libp2p/gossipsub";
import {Thread} from "@chainsafe/threads";
import {Logger} from "@lodestar/logger";
import {sleep} from "@lodestar/utils";
import {Metrics} from "../metrics/metrics.js";
import {NetworkCoreWorkerMetrics} from "../network/core/metrics.js";
import {EventDirection, NetworkEvent} from "../network/events.js";
import {StrictEventEmitterSingleArg} from "./strictEvents.js";

const NANO_TO_SECOND_CONVERSION = 1e9;

export type WorkerBridgeEvent<EventData> = {
  type: string;
  event: keyof EventData;
  posted: [number, number];
  data: EventData[keyof EventData];
};

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
  metrics: NetworkCoreWorkerMetrics | null,
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
      const [sec, nanoSec] = process.hrtime(data.posted);
      const networkWorkerLatency = sec + nanoSec / NANO_TO_SECOND_CONVERSION;
      metrics?.networkWorkerWireEventsOnWorkerThreadLatency.observe(
        {eventName: data.event as string},
        networkWorkerLatency
      );
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
          posted: process.hrtime(),
          data,
        };
        let transferList: ArrayBuffer[] | undefined = undefined;
        if (eventName === NetworkEvent.pendingGossipsubMessage) {
          const payload = data as {msg: Message};
          // Transfer the underlying ArrayBuffer to avoid copy for PendingGossipsubMessage
          transferList = [payload.msg.data.buffer as ArrayBuffer];
        }
        parentPort.postMessage(workerEvent, transferList);
      });
    }
  }
}

export function wireEventsOnMainThread<EventData>(
  mainEventName: string,
  events: StrictEventEmitterSingleArg<EventData>,
  worker: Pick<Worker, "on" | "postMessage">,
  metrics: Metrics | null,
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
      const [sec, nanoSec] = process.hrtime(data.posted);
      const networkWorkerLatency = sec + nanoSec / NANO_TO_SECOND_CONVERSION;
      metrics?.networkWorkerWireEventsOnMainThreadLatency.observe(
        {eventName: data.event as string},
        networkWorkerLatency
      );
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
          posted: process.hrtime(),
          data,
        };
        worker.postMessage(workerEvent);
      });
    }
  }
}

/**
 * Terminate a worker thread, bounded to `retryCount * retryMs`.
 *
 * @returns `true` if the worker terminated in time. Returns `false` if it could not be terminated
 * (it may be blocked in a native call that a forced `terminate()` can not preempt); in that case the
 * worker is still running and the caller must ensure it can not keep the process alive (e.g. by
 * `unref`-ing it). See #5775, #6053.
 */
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
}): Promise<boolean> {
  const terminated = new Promise((resolve) => {
    Thread.events(worker).subscribe((event) => {
      if (event.type === "termination") {
        resolve(true);
      }
    });
  });

  for (let i = 0; i < retryCount; i++) {
    // `Thread.terminate` is part of the race (rather than awaited before it) because it delegates to
    // Node's `worker.terminate()`, which can hang forever when the worker is blocked inside a
    // synchronous native (napi) call it can not preempt (V8 only tears down at a JS safepoint). If it
    // is awaited directly, the `retryCount * retryMs` budget is unreachable and shutdown hangs.
    const result = await Promise.race([
      terminated,
      Thread.terminate(worker).then(() => true),
      sleep(retryMs).then(() => false),
    ]);

    if (result) return true;

    logger?.warn("Worker thread failed to terminate, retrying...");
  }

  logger?.error(`Worker thread failed to terminate in ${retryCount * retryMs}ms`);
  return false;
}
