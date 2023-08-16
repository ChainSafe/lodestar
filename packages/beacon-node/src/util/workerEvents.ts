import {ChildProcess} from "node:child_process";
import v8 from "node:v8";
import {StrictEventEmitterSingleArg} from "./strictEvents.js";
import {WorkerProcessContext} from "./workerProcess.js";

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
export function wireEventsOnWorkerProcess<EventData>(
  mainEventName: string,
  events: StrictEventEmitterSingleArg<EventData>,
  parentPort: WorkerProcessContext,
  isWorkerToMain: {[K in keyof EventData]: EventDirection}
): void {
  // Subscribe to events from main thread
  parentPort.on("message", (raw: string) => {
    const data = v8.deserialize(Buffer.from(raw, "base64")) as WorkerBridgeEvent<EventData>;
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
        parentPort.send(Buffer.from(v8.serialize(workerEvent)).toString("base64"));
      });
    }
  }
}

export function wireEventsOnMainThread<EventData>(
  mainEventName: string,
  events: StrictEventEmitterSingleArg<EventData>,
  worker: ChildProcess,
  isWorkerToMain: {[K in keyof EventData]: EventDirection}
): void {
  // Subscribe to events from main thread
  worker.on("message", (raw: string) => {
    const data = v8.deserialize(Buffer.from(raw, "base64")) as WorkerBridgeEvent<EventData>;
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
        worker.send(Buffer.from(v8.serialize(workerEvent)).toString("base64"));
      });
    }
  }
}
