import assert from "node:assert/strict";
import {Worker} from "node:worker_threads";
import {mainnetChainConfig} from "@lodestar/config/configs";

export type PoolScenario = "idle environments" | "invalid capacity" | "pool metrics";

function readGauge(metrics: string, name: string): number {
  const match = metrics.match(new RegExp(`^${name} (\\d+)$`, "m"));
  assert.ok(match, `Missing gauge ${name}`);
  return Number(match[1]);
}

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
  case "pool metrics": {
    const {ssz} = await import("@lodestar/types");
    const {default: bindings} = await import("../../src/index.js");
    const {createStfState, stfConfig} = await import("../stfFixture.js");
    const {metrics} = bindings;
    metrics.init();
    assert.doesNotMatch(metrics.scrapeMetrics(), /^lodestar_pmt_/m);

    const config = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
    const value = createStfState();
    const state = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(value), config);
    const active = metrics.scrapeMetrics();
    const capacity = readGauge(active, "lodestar_pmt_node_pool_capacity");
    const occupied = readGauge(active, "lodestar_pmt_node_pool_nodes_in_use");
    const nodeBytes = readGauge(active, "lodestar_pmt_node_pool_reserved_bytes");
    const slabBytes = readGauge(active, "lodestar_pmt_chunked_leaf_slab_reserved_bytes");
    const liveSlabBytes = readGauge(active, "lodestar_pmt_chunked_leaf_slab_in_use_bytes");
    assert.equal(capacity, Number(process.env.LODESTAR_Z_NODE_POOL_CAPACITY));
    assert.ok(occupied > 0 && occupied < capacity);
    assert.ok(nodeBytes > 0);
    assert.ok(liveSlabBytes > 0 && liveSlabBytes < slabBytes);

    const containerNodes = readGauge(active, "lodestar_pmt_container_struct_nodes_in_use");
    const containerBytes = readGauge(active, "lodestar_pmt_container_struct_in_use_bytes");
    const viewCount = readGauge(active, "lodestar_pmt_struct_container_tree_views_in_use");
    const viewBytes = readGauge(active, "lodestar_pmt_struct_container_tree_view_in_use_bytes");
    assert.equal(containerNodes, value.validators.length);
    assert.ok(containerBytes > 0);

    state.getValidator(0);
    const withView = metrics.scrapeMetrics();
    assert.equal(readGauge(withView, "lodestar_pmt_container_struct_nodes_in_use"), containerNodes);
    assert.equal(readGauge(withView, "lodestar_pmt_container_struct_in_use_bytes"), containerBytes);
    assert.equal(readGauge(withView, "lodestar_pmt_struct_container_tree_views_in_use"), viewCount + 1);
    const cachedViewBytes = readGauge(withView, "lodestar_pmt_struct_container_tree_view_in_use_bytes");
    assert.ok(cachedViewBytes > viewBytes);
    assert.ok(readGauge(withView, "lodestar_pmt_pool_heap_bytes") >= containerBytes + cachedViewBytes);

    state.release();
    const released = metrics.scrapeMetrics();
    assert.equal(readGauge(released, "lodestar_pmt_node_pool_nodes_in_use"), 0);
    assert.equal(readGauge(released, "lodestar_pmt_chunked_leaf_slab_in_use_bytes"), 0);
    assert.equal(readGauge(released, "lodestar_pmt_node_pool_reserved_bytes"), nodeBytes);
    assert.equal(readGauge(released, "lodestar_pmt_chunked_leaf_slab_reserved_bytes"), slabBytes);
    assert.equal(readGauge(released, "lodestar_pmt_container_struct_nodes_in_use"), 0);
    assert.equal(readGauge(released, "lodestar_pmt_container_struct_in_use_bytes"), 0);
    assert.equal(readGauge(released, "lodestar_pmt_struct_container_tree_views_in_use"), 0);
    assert.equal(readGauge(released, "lodestar_pmt_struct_container_tree_view_in_use_bytes"), 0);
    break;
  }
  default:
    throw new Error(`Unknown pool scenario: ${process.argv[2]}`);
}
console.log("completed");
