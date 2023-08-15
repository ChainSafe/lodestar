import cp, {ChildProcess, Serializable} from "node:child_process";
import v8 from "node:v8";

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
    });

    this.child.on("exit", () => {
      // eslint-disable-next-line no-console
      console.log("Pending Requests ", this.pendingRequests.size);
      // eslint-disable-next-line no-console
      console.log("libp2p worker exited");
    });

    this.child.on("message", (data: unknown) => {
      if (isWorkerApiResponse(data)) {
        // eslint-disable-next-line no-console
        console.log("Received response on main thread", data);
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
        }
      }
    });
  }

  createApi<Api extends ParentWorkerApi<Api>>(): Api {
    return new Proxy({} as Api, {
      get: (_target, method: string) => {
        return (...args: unknown[]) => this.sendRequest(method, args);
      },
    });
  }

  private sendRequest(method: string, args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pendingRequests.set(id, {resolve, reject});
      this.child.send({id, method, args} as WorkerApiRequest);
      // eslint-disable-next-line no-console
      console.log("Sent request from main thread", {id, method, args});
    });
  }
}

export function exposeWorkerApi<Api extends ChildWorkerApi<Api>>(api: Api): void {
  const parentPort = process as WorkerProcessContext;
  parentPort.on("message", async (data: WorkerApiRequest) => {
    if (isWorkerApiRequest(data)) {
      // eslint-disable-next-line no-console
      console.log("Received request on worker", data);
      const {id, method, args} = data;
      try {
        // TODO: differentiate sync vs async methods, check if result is promise
        const result = await api[method as keyof Api](...args);
        parentPort.send({id, result} as WorkerApiResponse);
      } catch (error) {
        parentPort.send({id, error} as WorkerApiResponse);
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
