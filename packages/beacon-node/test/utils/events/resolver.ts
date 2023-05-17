import {TimeoutError} from "@lodestar/utils";

type EventEmitterSimple = {
  on(eventName: string | symbol, listener: (...args: any[]) => void): void;
};

export function waitForEvent<T>(
  emitter: EventEmitterSimple,
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
