import EventEmitter from "node:events";
import {Serializable} from "node:child_process";
import {WorkerApiRequest, WorkerApiResponse, deserializeData, serializeData} from "./workerProcess.js";

type ChildWorkerApi<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<R> : never;
};

export type WorkerProcessContext = NodeJS.Process & {
  send: (message: Serializable) => boolean;
};

function isWorkerApiRequest(data: unknown): data is WorkerApiRequest {
  return (
    typeof data === "object" &&
    (data as WorkerApiRequest).id !== undefined &&
    (data as WorkerApiRequest).method !== undefined
  );
}

export class WorkerApi extends EventEmitter {
  private parentPort: WorkerProcessContext;

  constructor() {
    super();
    this.parentPort = process as WorkerProcessContext;
  }

  send(data: Record<string, unknown>): boolean {
    return this.parentPort.send(serializeData(data));
  }

  expose<Api extends ChildWorkerApi<Api>>(api: Api): void {
    this.parentPort.on("message", async (raw: string) => {
      const data = deserializeData(raw);
      this.emit("message", data);
      if (isWorkerApiRequest(data)) {
        const {id, method, args = []} = data;
        try {
          // TODO: differentiate sync vs async methods, check if result is promise
          const result = await api[method as keyof Api](...args);
          this.parentPort.send(serializeData({id, result} as WorkerApiResponse));
        } catch (error) {
          this.parentPort.send(serializeData({id, error} as WorkerApiResponse));
        }
      }
    });
  }
}
