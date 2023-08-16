import EventEmitter from "node:events";
import {Serializable} from "node:child_process";
import {WorkerApiRequest, WorkerApiResponse, deserializeData, serializeData} from "./workerProcess.js";

type ChildWorkerApi<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<R> : never;
};

export type WorkerProcessContext = NodeJS.Process & {
  send: (message: Serializable) => boolean;
};

export class WorkerApi extends EventEmitter {
  private process: WorkerProcessContext;
  readonly workerData: Record<string, unknown>;

  constructor() {
    super();
    if (process.send === undefined) {
      throw Error("process.send must be defined");
    }
    this.process = process as WorkerProcessContext;
    const workerData = this.process.argv[2];
    if (!workerData) {
      throw Error("workerData must be defined");
    }
    this.workerData = deserializeData(workerData);

    // TODO: move init code to reusable function
    const exitSignals = ["SIGTERM", "SIGINT"] as NodeJS.Signals[];
    for (const signal of exitSignals) {
      this.process.on(signal, () => {
        // TODO: Is there another way to achieve this?
        // Ignore exit signals to prevent prematurely shutting down child process
      });
    }

    // TODO: remove
    this.process.on("unhandledRejection", (reason) => {
      // eslint-disable-next-line no-console
      console.error("Unhandled Rejection worker process:", reason);
    });

    // TODO: remove
    this.process.on("uncaughtException", (error) => {
      // eslint-disable-next-line no-console
      console.error("Uncaught Exception worker process:", error);
    });

    // TODO: remove
    // eslint-disable-next-line no-console
    this.process.on("exit", () => console.log("child exited"));
  }

  send(data: Record<string, unknown>): boolean {
    return this.process.send(serializeData(data));
  }

  expose<Api extends ChildWorkerApi<Api>>(api: Api): void {
    this.process.on("message", async (raw: string) => {
      const data = deserializeData(raw);
      this.emit("message", data);
      if (isWorkerApiRequest(data)) {
        const {id, method, args = []} = data;
        try {
          // TODO: differentiate sync vs async methods, check if result is promise
          const result = await api[method as keyof Api](...args);
          this.process.send(serializeData({id, result} as WorkerApiResponse));
        } catch (error) {
          this.process.send(serializeData({id, error} as WorkerApiResponse));
        }
      }
    });
  }
}

function isWorkerApiRequest(data: unknown): data is WorkerApiRequest {
  return (
    typeof data === "object" &&
    (data as WorkerApiRequest).id !== undefined &&
    (data as WorkerApiRequest).method !== undefined
  );
}
