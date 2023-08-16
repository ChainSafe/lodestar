import cp, {ChildProcess} from "node:child_process";
import {EventEmitter} from "node:events";
import v8 from "node:v8";
import {ErrorAborted} from "@lodestar/utils";

// TODO: How to ensure passed interface only has async methods?
type ParentWorkerApi<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R : never;
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

// TODO: Do we want to time out pending requests at some point and throw error?
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export class WorkerProcess extends EventEmitter {
  private child: ChildProcess;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();

  constructor(modulePath: string, workerData: Record<string, unknown>) {
    super();
    // TODO: There is likely a better way to send init data, use init message instead
    const serializedWorkerData = serializeData(workerData);

    // TODO: how do we know worker is ready? better way to initialize it?
    // TODO: listen on child "spawn" after fork, when is it ready?
    // TODO: resolve module path here, see Worker class in thread.js
    // TODO: pass other exec args, --max-old-space-size? inspect/inspect-brk for debugging? forward process.execArgv?
    this.child = cp.fork(modulePath, [serializedWorkerData], {
      // https://nodejs.org/api/child_process.html#advanced-serialization
      // TODO: advanced serialization does not work, hard to reproduce in a simple setup, further investigation required
      serialization: "json",
    });

    this.child.on("exit", () => {
      // eslint-disable-next-line no-console
      console.log("Pending Requests ", this.pendingRequests.size);
      for (const request of this.pendingRequests.values()) {
        // This can cause `error: uncaughtException: Aborted` on shutdown, needs be handled differently
        // TODO: is this correct?
        request.reject(new ErrorAborted());
      }
      // eslint-disable-next-line no-console
      console.log("libp2p worker exited");
    });

    this.child.on("message", (raw: string) => {
      const data = deserializeData(raw);
      this.emit("message", data);
      if (isWorkerApiResponse(data)) {
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

    // TODO: remove
    process.on("exit", () => {
      // eslint-disable-next-line no-console
      console.log(this.pendingRequests);
    });
  }

  send(data: Record<string, unknown>): boolean {
    if (!this.child.connected) {
      // TODO: If we consider restarting cp if it crashed this needs to be handled differently
      // Send data must be buffered and resend once cp is up again or another error must be thrown
      throw new ErrorAborted();
    }
    return this.child.send(serializeData(data));
  }

  terminate(): void {
    this.child.kill("SIGKILL");
    // TODO: unref needed?
    // this.modules.worker.unref();
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
      this.send({id, method, args} as WorkerApiRequest);
    });
  }
}

export function serializeData(data: Record<string, unknown>): string {
  return v8.serialize(data).toString("base64");
}

export function deserializeData(raw: string): Record<string, unknown> {
  return v8.deserialize(Buffer.from(raw, "base64")) as Record<string, unknown>;
}

function isWorkerApiResponse(data: unknown): data is WorkerApiResponse {
  return typeof data === "object" && (data as WorkerApiResponse).id !== undefined;
}
