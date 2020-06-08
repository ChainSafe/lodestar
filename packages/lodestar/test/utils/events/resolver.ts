import {EventEmitter} from "events";

export async function waitForEvent<T>(emitter: EventEmitter, event: string, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(reject, timeout);
    emitter.on(event, (e) => {
      clearTimeout(timer);
      resolve(e);
    });
  });
}
