import assert from "node:assert/strict";
import {createNativeNetwork} from "../../src/network.js";
import {applicationConfig} from "../utils/network.js";

let capacityReads = 0;
const {promise: failed, resolve: fail} = Promise.withResolvers();
const error = new Error("capacity failed");
const runtime = createNativeNetwork(applicationConfig(), {
  subscribeCapacity: () => () => {},
  capacity: () => { capacityReads++; throw error; },
  validate: async () => [],
  checkDependencies: () => [],
  serve: (request) => request.cancel(),
  peers: () => {},
  failed: fail,
  logs: () => {},
});
await runtime.getIdentity();
assert.equal(await failed, error);
assert.equal(capacityReads, 1);
assert.deepEqual(await runtime.close(), {reason: "requested"});
console.log("capacity failed; identity settled; closed");
