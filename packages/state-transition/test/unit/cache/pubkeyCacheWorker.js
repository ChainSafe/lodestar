/**
 * Helper file that spawns worker(s) to act on the global native pubkey cache.
 *
 * Because the global native pubkey cache supports multithreaded access, we need
 * to spawn worker threads that test that it works as intended.
 *
 * See pubkeyCache.test.ts for usage.
 */
import worker from "node:worker_threads";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {interopSecretKey, syncPubkeys} from "@lodestar/state-transition";

const parentPort = worker.parentPort;
if (!parentPort) throw Error("parentPort must be defined");

parentPort.on("message", (task) => {
  const cache = pubkeyCache;

  if (task.type === "get") {
    const entries = {};
    for (const idx of task.indices ?? []) {
      const pk = cache.get(idx);
      entries[idx] = pk ? Buffer.from(pk.toBytes()).toString("hex") : null;
    }
    parentPort.postMessage({type: "get", entries, size: cache.size});
  } else if (task.type === "getIndex") {
    const indexResults = {};
    for (const pkHex of task.pubkeys ?? []) {
      const pkBytes = Buffer.from(pkHex, "hex");
      const index = cache.getIndex(pkBytes);
      indexResults[pkHex] = index;
    }
    parentPort.postMessage({type: "getIndex", indexResults, size: cache.size});
  } else if (task.type === "set") {
    const startIndex = task.startIndex ?? 0;
    const count = task.count ?? 0;
    for (let i = startIndex; i < startIndex + count; i++) {
      const sk = interopSecretKey(i);
      cache.set(i, sk.toPublicKey().toBytes());
    }
    parentPort.postMessage({type: "set", size: cache.size});
  } else if (task.type === "syncPubkeys") {
    const totalCount = task.totalCount ?? 0;
    const cacheSize = cache.size;
    const validators = new Array(totalCount);
    for (let i = cacheSize; i < totalCount; i++) {
      const sk = interopSecretKey(i);
      validators[i] = {pubkey: sk.toPublicKey().toBytes()};
    }
    syncPubkeys(cache, validators);
    parentPort.postMessage({type: "syncPubkeys", size: cache.size});
  }
});
