import assert from "node:assert/strict";
import {ssz} from "@lodestar/types";
import bindings from "../../src/index.js";
import {pubkeyCache} from "../../src/pubkeys.js";
import {createGloasState, gloasConfig} from "../gloasFixture.js";

const value = createGloasState();
pubkeyCache.ensureCapacity(value.validators.length);
const config = new bindings.BeaconConfig(gloasConfig, value.genesisValidatorsRoot);
const state = bindings.BeaconStateView.createFromBytes(ssz.gloas.BeaconState.serialize(value), config);
const clone = state.processSlots(state.slot, {dontTransferCache: true});
Object.defineProperty(Object.prototype, "executionPayment", {
  configurable: true,
  set(payment: bigint) {
    state.release();
    assert.throws(() => state.slot, {code: "InvalidState"});
    Object.defineProperty(this, "executionPayment", {enumerable: true, value: payment});
  },
});
let bid;
try {
  bid = state.latestExecutionPayloadBid;
} finally {
  Reflect.deleteProperty(Object.prototype, "executionPayment");
}
assert.deepEqual(bid, value.latestExecutionPayloadBid);
assert.deepEqual(clone.hashTreeRoot(), ssz.gloas.BeaconState.hashTreeRoot(value));
clone.release();
assert.equal(bid.executionPayment, value.latestExecutionPayloadBid.executionPayment);
console.log("completed");
