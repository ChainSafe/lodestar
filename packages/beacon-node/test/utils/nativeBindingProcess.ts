import {fork} from "node:child_process";
import type {
  NativeApplicationConfig,
  NativeIdentity,
  NativeLocalIntent,
  NativePeerSnapshot,
} from "@chainsafe/lodestar-z/network";
import type {BeaconConfig} from "@lodestar/config";

export async function nativeBindingProcess(config: Omit<NativeApplicationConfig, "logLevel">, chain: BeaconConfig) {
  const child = fork(new URL("./nativeBindingPeer.mjs", import.meta.url), [], {
    serialization: "advanced",
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    execArgv: [],
  });
  let sequence = 0;
  const pending = new Map<
    number,
    {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout}
  >();
  child.on("message", (message: {id: number; value?: unknown; error?: Error}) => {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(message.error);
    else item.resolve(message.value);
  });
  const kill = () => {
    child.kill();
  };
  process.once("exit", kill);
  child.on("exit", () => {
    process.removeListener("exit", kill);
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("Native binding peer exited"));
    }
    pending.clear();
  });
  function call<T>(method: string, args: unknown[]): Promise<T> {
    if (pending.size >= 16 || !child.connected) return Promise.reject(new Error("Native binding peer unavailable"));
    const id = ++sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
      }, 10000);
      pending.set(id, {resolve: (value) => resolve(value as T), reject, timer});
      child.send({id, method, args});
    });
  }
  try {
    const values = Object.fromEntries(Object.entries(chain).filter(([key]) => key === key.toUpperCase()));
    const identity = await call<NativeIdentity>("initialize", [
      {...config, beaconConfig: undefined},
      values,
      chain.genesisValidatorsRoot,
    ]);
    return {
      identity,
      applyIntent: (value: NativeLocalIntent, slot: bigint) => call<void>("applyIntent", [value, slot]),
      getPeers: () => call<NativePeerSnapshot>("getPeers", []),
      async close() {
        try {
          await call("close", []);
        } finally {
          child.kill();
        }
      },
    };
  } catch (error) {
    child.kill();
    throw error;
  }
}
