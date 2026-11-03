import assert from "node:assert/strict";
import {ssz} from "@lodestar/types";
import bindings from "../../src/index.js";
import {pubkeyCache} from "../../src/pubkeys.js";
import {createStfState, stfConfig} from "../stfFixture.js";

assert.equal(typeof global.gc, "undefined");
const config = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
pubkeyCache.ensureCapacity(16);
const bytes = ssz.fulu.BeaconState.serialize(createStfState());
const seed = bindings.BeaconStateView.createFromBytes(bytes, config);
const seedRoot = seed.hashTreeRoot();
for (let i = 0; i < 500; i++) {
  assert.equal(bindings.BeaconStateView.createFromBytes(bytes, config).forkSeq, 6, `iteration ${i}`);
  assert.equal(seed.processSlots(seed.slot).slot, seed.slot, `clone ${i}`);
  await new Promise((resolve) => setImmediate(resolve));
}
assert.deepEqual(seed.hashTreeRoot(), seedRoot);
console.log("completed");
