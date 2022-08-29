import {EventEmitter} from "events";
import {TimeoutError} from "@lodestar/utils";

export * from "./LodestarBeaconNodeProcess.js";
export * from "./SimulationEnvironment.js";
export * from "./utils.js";

export function waitForEvent<T>(
  emitter: EventEmitter,
  event: string,
  timeout = 3000,
  condition: (e: T) => boolean = () => true
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`event ${event} not received`)), timeout);
    emitter.on(event, (e) => {
      if (condition(e)) {
        clearTimeout(timer);
        resolve(e);
      }
    });
  });
}
