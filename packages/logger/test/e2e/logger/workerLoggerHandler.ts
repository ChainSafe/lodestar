import workerThreads from "node:worker_threads";
import {spawn, Worker} from "@chainsafe/threads";

export type LoggerWorker = {
  log(data: string): void;
  close(): Promise<void>;
};

type WorkerData = {logFilepath: string};

export async function getLoggerWorker(opts: WorkerData): Promise<LoggerWorker> {
  const workerThreadjs = new Worker("./workerLogger.js", {
    workerData: opts,
  });
  const worker = workerThreadjs as unknown as workerThreads.Worker;

  await spawn<any>(workerThreadjs, {
    // A Lodestar Node may do very expensive task at start blocking the event loop and causing
    // the initialization to timeout. The number below is big enough to almost disable the timeout
    timeout: 5 * 60 * 1000,
    // TODO: types are broken on spawn, which claims that `NetworkWorkerApi` does not satifies its contrains
  });

  return {
    log(data) {
      worker.postMessage(data);
    },

    async close() {
      await workerThreadjs.terminate();
    },
  };
}
