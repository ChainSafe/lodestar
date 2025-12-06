import path from "node:path";
import {fileURLToPath} from "node:url";
import {Worker} from "node:worker_threads";

export type LoggerWorker = {
  log(data: string): void;
  close(): Promise<void>;
};

type WorkerData = {logFilepath: string};

export async function getLoggerWorker(opts: WorkerData): Promise<LoggerWorker> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const worker = new Worker(path.join(__dirname, "workerLogger.js"), {
    workerData: opts,
  });

  // Wait for worker to be online
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Logger worker initialization timeout"));
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

  return {
    log(data) {
      worker.postMessage(data);
    },

    async close() {
      await worker.terminate();
    },
  };
}
