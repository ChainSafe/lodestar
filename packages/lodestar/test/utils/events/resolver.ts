import {EventEmitter} from "events";

export async function waitForEvent<T>(
  emitter: EventEmitter,
  event: string,
  timeout = 3000,
  condition: (e: T) => boolean = () => true
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(reject, timeout);
    emitter.on(event, (e) => {
      if(condition(e)) {
        clearTimeout(timer);
        resolve(e);
      }
    });
  });
}
