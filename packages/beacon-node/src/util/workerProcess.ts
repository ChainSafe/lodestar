import cp, {ChildProcess, Serializable} from "node:child_process";
import v8 from "node:v8";
import {ErrorAborted} from "@lodestar/utils";

// TODO: How to ensure passed interface only has async methods?
type ParentWorkerApi<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R : never;
};

type ChildWorkerApi<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<R> : never;
};

export type WorkerApiRequest = {
  id: number;
  method: string;
  args: unknown[];
};

// TODO: wrapped res? see err.ts
export type WorkerApiResponse =
  | {
      id: number;
      result: unknown;
      error: undefined;
    }
  | {
      id: number;
      result: undefined;
      error: Error;
    };

export type WorkerProcessContext = NodeJS.Process & {
  send: (message: Serializable) => boolean;
};

type WorkerData = Record<string, unknown>;

type PendingRequest = {
  method: string;
  args: unknown[];
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export class WorkerProcess {
  // TODO: Should not expose child
  readonly child: ChildProcess;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();

  constructor(modulePath: string, workerData: WorkerData) {
    // TODO: There is likely a better way to send init data
    const serializedWorkerData = Buffer.from(v8.serialize(workerData)).toString("base64");

    // TODO: how do we know worker is ready? better way to initialize it?
    // TODO: worker on "spawn" was after fork, when is it ready?
    // TODO: resolve module path here, see Worker class in thread.js
    // TODO: pass other exec args, --max-old-space-size? inspect/inspect-brk for debugging?
    this.child = cp.fork(modulePath, [serializedWorkerData], {
      // https://nodejs.org/api/child_process.html#advanced-serialization
      serialization: "advanced",
      // TODO: is this required?
      // killSignal: "SIGKILL",
    });

    process.on("exit", () => {
      // eslint-disable-next-line no-console
      console.log(this.pendingRequests);
    });

    this.child.on("exit", () => {
      // eslint-disable-next-line no-console
      console.log("Pending Requests ", this.pendingRequests.size);
      for (const request of this.pendingRequests.values()) {
        // TODO: is this correct?
        request.reject(new ErrorAborted());
      }
      // eslint-disable-next-line no-console
      console.log("libp2p worker exited");
    });

    this.child.on("message", (data: unknown) => {
      if (isWorkerApiResponse(data)) {
        // eslint-disable-next-line no-console
        console.log("Received response on main thread", data.id);
        const {id, result, error} = data;
        const request = this.pendingRequests.get(id);
        if (request) {
          if (error) {
            // TODO: util.inspect required on child before sending? Are all errors instanceof Error?
            request.reject(error);
          } else {
            request.resolve(result);
          }
          this.pendingRequests.delete(id);
        } else {
          throw Error(`request for with id was undefined: ${id}`);
        }
      } else {
        // console.log("Not API response received on main thread with type", typeof data);
        if (!(data as any).type) {
          console.log("Not an event either", data);
        }
      }
    });

    setInterval(() => {
      if (!this.child.channel) {
        console.log("IPC channel is broken");
      }
    }, 1000);

    this.child.on("disconnect", () => console.log("child disconnected"));
    this.child.on("close", (e) => console.log("child closed", e));
    this.child.on("error", (e) => console.log("child error", e));
    this.child.on("spawn", () => console.log("child spawned"));
  }

  createApi<Api extends ParentWorkerApi<Api>>(): Api {
    return new Proxy({} as Api, {
      get: (_target, method: string) => {
        return (...args: unknown[]) => this.sendRequest(method, args);
      },
    });
  }

  private sendRequest(method: string, args: unknown[]): Promise<unknown> {
    if (!this.child.connected) {
      console.log("Child process is no longer connected");
      throw new ErrorAborted();
    }
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pendingRequests.set(id, {method, args, resolve, reject});
      this.child.send({id, method, args} as WorkerApiRequest);
      // eslint-disable-next-line no-console
      console.log("Sent request from main thread", {id, method});
    });
  }
}

export function exposeWorkerApi<Api extends ChildWorkerApi<Api>>(api: Api): void {
  const parentPort = process as WorkerProcessContext;
  parentPort.on("message", async (data: WorkerApiRequest) => {
    if (isWorkerApiRequest(data)) {
      // eslint-disable-next-line no-console
      const {id, method, args = []} = data;
      console.log("Received request on worker", {id, method});
      try {
        // TODO: differentiate sync vs async methods, check if result is promise
        const promise = api[method as keyof Api](...args);
        // console.log("Result before await", promise);
        const result = await promise;
        parentPort.send({id, result} as WorkerApiResponse);
        console.log("Sent result from worker", {id, method});
      } catch (error) {
        parentPort.send({id, error} as WorkerApiResponse);
        console.log("Sent error from worker", {id, method});
      }
    }
  });
}

export function getWorkerData(): WorkerData {
  return v8.deserialize(Buffer.from(process.argv[2], "base64")) as WorkerData;
}

function isWorkerApiRequest(data: unknown): data is WorkerApiRequest {
  return (
    typeof data === "object" &&
    (data as WorkerApiRequest).id !== undefined &&
    (data as WorkerApiRequest).method !== undefined
  );
}

function isWorkerApiResponse(data: unknown): data is WorkerApiResponse {
  return typeof data === "object" && (data as WorkerApiResponse).id !== undefined;
}
