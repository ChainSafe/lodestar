import assert from "node:assert/strict";
import {createNativeNetwork} from "../../src/network.js";
import {applicationConfig} from "../utils/network.js";

const deadline = setTimeout(() => {
  throw Error("Block import did not settle");
}, 5000);
const network = createNativeNetwork(applicationConfig(), {
  subscribeCapacity: () => () => {},
  capacity: () => ({gossipValidation: "backpressured"}),
  checkDependencies: (checks) => checks.map(() => false),
  failed: () => undefined,
  logs: () => undefined,
  peers: () => undefined,
  serve: (request) => request.cancel(),
  validate: (job) => Promise.resolve(job.messages.map(() => "ignore")),
});
network.stopDelivery();
try {
  const root = new Uint8Array(32).fill(1);
  network.blockImported(root);
  root.fill(2);
  network.blockImported(root);
  structuredClone(root, {transfer: [root.buffer]});
  await network.getIdentity();
} finally {
  assert.deepEqual(await network.close(), {reason: "requested"});
  clearTimeout(deadline);
}
console.log("queued roots survived buffer reuse and transfer");
