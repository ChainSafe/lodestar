import {fork} from "node:child_process";
import type {
  NativeApplicationConfig,
  NativeIdentity,
  NativeRequestOptions,
  NativeResponseChunk,
} from "../../src/network.js";
import type {NativeIncomingRequest, NativeRuntimeCloseResult} from "../../src/network-types.js";
import {configuredChain} from "./network.js";
import type {NetworkTestRuntime} from "./network-runtime.js";

type AsyncMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : T[K];
};
export type PeerRuntime = Omit<AsyncMethods<NetworkTestRuntime>, "request" | "takeIncomingRequest"> & {
  request: NetworkTestRuntime["request"];
  takeIncomingRequest(): Promise<NativeIncomingRequest | null>;
  /** Closes the runtime and waits for the child process to exit. */
  stop(): Promise<void>;
};

type Reply = {id: number; value?: unknown; error?: {message: string; stack?: string; [key: string]: unknown}};

export async function startPeer(config: NativeApplicationConfig): Promise<PeerRuntime> {
  const child = fork(new URL("../fixtures/network-peer.mjs", import.meta.url), [], {
    execArgv: ["--import", "tsx"],
    serialization: "advanced",
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  child.unref();
  child.channel?.unref();
  let sequence = 0;
  const pending = new Map<
    number,
    {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout}
  >();
  child.on("message", (message: Reply) => {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(Object.assign(new Error(message.error.message), message.error));
    else request.resolve(message.value);
    if (pending.size === 0) child.channel?.unref();
  });
  let didExit = false;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.on("exit", (code, signal) => {
    didExit = true;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(`Network peer exited: ${code ?? signal}`));
    }
    pending.clear();
    process.removeListener("exit", kill);
  });
  const kill = () => {
    child.kill();
  };
  process.once("exit", kill);
  function call<T>(method: string, args: unknown[] = [], timeoutMs = 65000): Promise<T> {
    if (!child.connected) return Promise.reject(new Error("Network peer disconnected"));
    if (pending.size >= 256) return Promise.reject(new Error("Network peer command capacity"));
    const id = ++sequence;
    child.channel?.ref();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Network peer timeout: ${method}`));
        child.kill();
      }, timeoutMs);
      pending.set(id, {reject, resolve: (value) => resolve(value as T), timer});
      child.send({args, id, method});
    });
  }
  async function terminate(): Promise<void> {
    if (didExit) return;
    child.ref();
    child.kill();
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    let exitTimer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        exited,
        new Promise<never>((_, reject) => {
          exitTimer = setTimeout(() => reject(new Error("Network peer did not exit")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(killTimer);
      clearTimeout(exitTimer);
    }
  }
  let stopping: Promise<void> | undefined;
  function stop(): Promise<void> {
    stopping ??= (async () => {
      try {
        if (child.connected) await call("close", [], 5000);
      } finally {
        await terminate();
      }
    })();
    return stopping;
  }
  try {
    const identity = await call<NativeIdentity>("initialize", [
      {...config, beaconConfig: null},
      configuredChain(config),
    ]);
    const closed = call<NativeRuntimeCloseResult>("closed");
    void closed.catch(() => undefined);
    const overrides = {
      closed,
      identity,
      request(peer: string, protocol: string, data: Uint8Array, options?: NativeRequestOptions) {
        const handle = call<number>("request", [peer, protocol, data, options]);
        void handle.catch(() => undefined);
        return {
          [Symbol.asyncIterator]() {
            return this;
          },
          async next() {
            return call<IteratorResult<NativeResponseChunk>>("requestNext", [await handle]);
          },
          async return() {
            return call<IteratorResult<NativeResponseChunk>>("requestReturn", [await handle]);
          },
          async throw(error: unknown) {
            await this.return();
            throw error;
          },
        };
      },
      stop,
      async takeIncomingRequest(): Promise<NativeIncomingRequest | null> {
        const descriptor = await call<{
          id: number;
          peerId: string;
          connection: NativeIncomingRequest["connection"];
          protocol: NativeIncomingRequest["protocol"];
          data: Uint8Array;
        } | null>("takeIncomingRequest");
        if (!descriptor) return null;
        const closed = call<void>("incomingClosed", [descriptor.id]);
        let retained = false;
        const release = () => (stopping ? Promise.resolve() : call<void>("incomingRelease", [descriptor.id]));
        const releaseUnretained = () => {
          if (!retained) return release();
        };
        void closed.then(releaseUnretained, releaseUnretained);
        return {
          ...descriptor,
          async cancel() {
            await call("incomingCancel", [descriptor.id]);
            return closed;
          },
          closed,
          async fail(status, message) {
            await call("incomingFail", [descriptor.id, status, message]);
            return closed;
          },
          async finish() {
            await call("incomingFinish", [descriptor.id]);
            return closed;
          },
          ready: () => call("incomingReady", [descriptor.id]),
          respond: (data, context) => call("incomingRespond", [descriptor.id, data, context]),
          retainUntil(retired) {
            retained = true;
            void retired.then(release, release);
          },
        };
      },
    };
    return new Proxy(overrides, {
      get(target, property) {
        if (property === "then") return undefined;
        if (property in target) return Reflect.get(target, property);
        return (...args: unknown[]) => call(String(property), args);
      },
    }) as unknown as PeerRuntime;
  } catch (error) {
    await terminate();
    throw error;
  }
}
