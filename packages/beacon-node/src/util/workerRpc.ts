import {MessagePort, Worker} from "node:worker_threads";

/**
 * RPC message format for worker communication
 */
export type RpcMessage = {
  type: "rpc";
  id: number;
  method: string;
  args: unknown[];
};

/**
 * RPC response format for worker communication
 */
export type RpcResponse = {
  type: "rpc-response";
  id: number;
  result?: unknown;
  error?: {message: string; stack?: string};
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * Creates a proxy that forwards method calls to a worker via RPC
 */
export function createWorkerRpcClient<T extends object>(
  worker: Worker,
  _filter?: (message: unknown) => boolean
): {api: T; close: () => void} {
  const pendingRequests = new Map<number, PendingRequest>();
  let nextId = 0;

  const handleMessage = (message: unknown): void => {
    if (typeof message !== "object" || message === null) return;
    const response = message as RpcResponse;
    if (response.type !== "rpc-response") return;

    const pending = pendingRequests.get(response.id);
    if (!pending) return;

    pendingRequests.delete(response.id);

    if (response.error) {
      const error = new Error(response.error.message);
      if (response.error.stack) error.stack = response.error.stack;
      pending.reject(error);
    } else {
      pending.resolve(response.result);
    }
  };

  worker.on("message", handleMessage);

  const api = new Proxy({} as T, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;

      return (...args: unknown[]): Promise<unknown> => {
        return new Promise((resolve, reject) => {
          const id = nextId++;
          pendingRequests.set(id, {resolve, reject});

          const message: RpcMessage = {
            type: "rpc",
            id,
            method: prop,
            args,
          };

          worker.postMessage(message);
        });
      };
    },
  });

  const close = (): void => {
    // Reject all pending requests
    for (const pending of pendingRequests.values()) {
      pending.reject(new Error("Worker RPC client closed"));
    }
    pendingRequests.clear();
  };

  return {api, close};
}

/**
 * Handles RPC calls on the worker side
 */
export function handleWorkerRpc<T extends object>(
  parentPort: MessagePort,
  api: T,
  filter?: (message: unknown) => boolean
): void {
  parentPort.on("message", async (message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    const rpcMessage = message as RpcMessage;
    if (rpcMessage.type !== "rpc") return;
    if (filter && !filter(message)) return;

    const {id, method, args} = rpcMessage;

    try {
      const fn = (api as Record<string, unknown>)[method];
      if (typeof fn !== "function") {
        throw new Error(`Unknown method: ${method}`);
      }

      const result = await fn.apply(api, args);

      const response: RpcResponse = {
        type: "rpc-response",
        id,
        result,
      };

      parentPort.postMessage(response);
    } catch (e) {
      const response: RpcResponse = {
        type: "rpc-response",
        id,
        error: {
          message: (e as Error).message,
          stack: (e as Error).stack,
        },
      };

      parentPort.postMessage(response);
    }
  });
}
