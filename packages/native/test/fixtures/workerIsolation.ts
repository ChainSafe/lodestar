import assert from "node:assert/strict";
import crypto from "node:crypto";
import {parentPort, workerData} from "node:worker_threads";

export type IsolationScenario = "blst" | "pubkeys";

assert(parentPort);
switch (workerData) {
  case "blst": {
    const {SecretKey, verify} = await import("../../src/blst.js");
    try {
      const sk = SecretKey.fromKeygen(crypto.randomBytes(32));
      const pk = sk.toPublicKey();
      const msg = crypto.randomBytes(32);
      const sig = sk.sign(msg);
      parentPort.postMessage(verify(msg, pk, sig) ? "ok" : "verify failed in worker");
    } catch (error) {
      parentPort.postMessage(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
    break;
  }
  case "pubkeys": {
    const {pubkeyCache} = await import("../../src/pubkeys.js");
    parentPort.postMessage({
      load: capture(() => pubkeyCache.load("", 1)),
      pubkey: pubkeyCache.getOrThrow(0).toBytes(),
      reset: capture(() => pubkeyCache.reset()),
      save: capture(() => pubkeyCache.save("")),
    });
    break;
  }
  default:
    throw new Error(`Unknown isolation scenario: ${workerData}`);
}

function capture(operation: () => unknown): string | null {
  try {
    operation();
    return null;
  } catch (error) {
    return String(error instanceof Error ? error.message : error);
  }
}
