import {StrictEventEmitterSingleArg} from "./strictEvents.js";
import {WorkerProcess} from "./workerProcess.js";
import {WorkerApi} from "./workerApi.js";

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

// TODO: wire events in WorkerProcess and WorkerApi respectively, expose methods that call those functions internally?

/**
 * Bridges events from worker to main thread
 * Each event can only have one direction:
 * - worker to main
 * - main to worker
 */
export function wireEventsOnWorkerProcess<EventData>(
  mainEventName: string,
  events: StrictEventEmitterSingleArg<EventData>,
  workerApi: WorkerApi,
  isWorkerToMain: {[K in keyof EventData]: EventDirection}
): void {
  // Subscribe to events from main thread
  workerApi.on("message", (data: WorkerBridgeEvent<EventData>) => {
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
        workerApi.send(workerEvent);
      });
    }
  }
}

export function wireEventsOnMainThread<EventData>(
  mainEventName: string,
  events: StrictEventEmitterSingleArg<EventData>,
  worker: WorkerProcess,
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
        worker.send(workerEvent);
      });
    }
  }
}
