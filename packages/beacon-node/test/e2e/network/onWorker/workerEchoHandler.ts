import path from "node:path";
import {Worker} from "node:worker_threads";
import {fileURLToPath} from "node:url";

export type EchoWorker = {
  send<T>(data: T): Promise<T>;
  close(): Promise<void>;
};

export async function getEchoWorker(): Promise<EchoWorker> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const worker = new Worker(path.join(__dirname, "workerEcho.js"));

  // Wait for worker to be online
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Echo worker initialization timeout"));
    }, 5 * 60 * 1000);

    worker.once("online", () => {
      clearTimeout(timeout);
      resolve();
    });

    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  // Track pending requests
  let requestId = 0;
  const pending = new Map<number, {resolve: (data: unknown) => void; reject: (err: Error) => void}>();

  worker.on("message", (msg: {id: number; data: unknown}) => {
    const handler = pending.get(msg.id);
    if (handler) {
      pending.delete(msg.id);
      handler.resolve(msg.data);
    }
  });

  worker.on("error", (err) => {
    for (const handler of pending.values()) {
      handler.reject(err);
    }
    pending.clear();
  });

  return {
    send<T>(data: T): Promise<T> {
      return new Promise((resolve, reject) => {
        const id = requestId++;
        pending.set(id, {resolve: resolve as (data: unknown) => void, reject});
        worker.postMessage({id, data});
      });
    },

    async close() {
      await worker.terminate();
    },
  };
}
