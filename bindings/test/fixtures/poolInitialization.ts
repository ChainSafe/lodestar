import assert from "node:assert/strict";
import {Worker} from "node:worker_threads";
import {mainnetChainConfig} from "@lodestar/config/configs";

export type PoolScenario = "idle environments" | "invalid capacity";

switch (process.argv[2]) {
  case "idle environments": {
    const beforeImport = process.memoryUsage.rss();
    const {SecretKey} = await import("../../src/blst.js");
    const {default: bindings} = await import("../../src/index.js");
    Object.assign(globalThis, {config: new bindings.BeaconConfig(mainnetChainConfig, new Uint8Array(32))});
    assert.equal(SecretKey.fromKeygen(new Uint8Array(32).fill(1)).toPublicKey().toBytes().length, 48);
    const afterImport = process.memoryUsage.rss();
    const budget = 128 * 1024 * 1024;
    assert.ok(afterImport - beforeImport < budget, "idle main environment reserved a tree pool");
    const worker = new Worker(new URL("./idleEnvironment.ts", import.meta.url), {execArgv: ["--import", "tsx"]});
    try {
      await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      });
      assert.ok(process.memoryUsage.rss() - afterImport < budget, "idle worker reserved a tree pool");
    } finally {
      await worker.terminate();
    }
    break;
  }
  case "invalid capacity": {
    const {ssz} = await import("@lodestar/types");
    const {default: bindings} = await import("../../src/index.js");
    const {pubkeyCache} = await import("../../src/pubkeys.js");
    const {createStfState, stfConfig} = await import("../stfFixture.js");
    const config = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
    pubkeyCache.ensureCapacity(16);
    const value = createStfState();
    const bytes = ssz.fulu.BeaconState.serialize(value);
    assert.throws(() => bindings.BeaconStateView.createFromBytes(bytes.subarray(0, 47), config), {
      code: "InvalidStateBytes",
    });
    for (const capacity of ["invalid", "2147483647"]) {
      process.env.LODESTAR_Z_NODE_POOL_CAPACITY = capacity;
      for (let i = 0; i < 10; i++) {
        assert.throws(
          () => bindings.BeaconStateView.createFromBytes(bytes, config),
          {code: "InvalidPoolCapacity"},
          `${capacity}: ${i}`
        );
      }
    }
    process.env.LODESTAR_Z_NODE_POOL_CAPACITY = "1000000";
    const state = bindings.BeaconStateView.createFromBytes(bytes, config);
    assert.equal(state.slot, value.slot);
    assert.equal(state.processSlots(state.slot + 1).slot, state.slot + 1);
    break;
  }
  default:
    throw new Error(`Unknown pool scenario: ${process.argv[2]}`);
}
console.log("completed");
