import path from "node:path";
import assert from "node:assert";
import {toHexString} from "@chainsafe/ssz";
import {routes, fetch} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {Simulation} from "../utils/crucible/simulation.js";
import {BeaconClient, ExecutionClient} from "../utils/crucible/interfaces.js";
import {defineSimTestConfig, logFilesDir} from "../utils/crucible/utils/index.js";
import {waitForSlot} from "../utils/crucible/utils/network.js";

const altairForkEpoch = 2;
const bellatrixForkEpoch = 4;
const validatorCount = 2;

const {estimatedTimeoutMs, forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  runTillEpoch: 2,
  initialNodes: 1,
});

const env = await Simulation.initWithDefaults(
  {
    id: "beacon-endpoints",
    logsDir: path.join(logFilesDir, "beacon-endpoints"),
    forkConfig,
  },
  [
    {
      id: "node-1",
      beacon: {type: BeaconClient.Lodestar, options: {clientOptions: {"sync.isSingleNode": true}}},
      execution: ExecutionClient.Geth,
      keysCount: validatorCount,
      mining: true,
    },
  ]
);
await env.start({runTimeoutMs: estimatedTimeoutMs});

const node = env.nodes[0].beacon;
await waitForSlot("Wait for 2 slots before checking endpoints", {env, slot: 2});

const validators = (await node.api.beacon.postStateValidators({stateId: "head"})).value();

await env.tracker.assert("should have correct validators count called without filters", async () => {
  assert.equal(validators.length, validatorCount);
});

await env.tracker.assert("should have correct validator index for first validator filters", async () => {
  assert.equal(validators[0].index, 0);
});

await env.tracker.assert("should have correct validator index for second validator filters", async () => {
  assert.equal(validators[1].index, 1);
});

await env.tracker.assert(
  "should return correct number of filtered validators when postStateValidators called with filters",
  async () => {
    const filterPubKey =
      "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";

    const res = await node.api.beacon.postStateValidators({stateId: "head", validatorIds: [filterPubKey]});

    assert.equal(res.value().length, 1);

    const {executionOptimistic, finalized} = res.meta();
    assert.equal(executionOptimistic, false);
    assert.equal(finalized, false);
  }
);

await env.tracker.assert(
  "should return correct filtered validators when postStateValidators called with filters",
  async () => {
    const filterPubKey =
      "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";

    const res = await node.api.beacon.postStateValidators({stateId: "head", validatorIds: [filterPubKey]});

    assert.equal(toHexString(res.value()[0].validator.pubkey), filterPubKey);
  }
);

await env.tracker.assert(
  "should return the validator when getStateValidator is called with the validator index",
  async () => {
    const validatorIndex = 0;

    const res = await node.api.beacon.getStateValidator({stateId: "head", validatorId: validatorIndex});

    assert.equal(res.value().index, validatorIndex);
  }
);

await env.tracker.assert(
  "should return the validator when getStateValidator is called with the hex encoded public key",
  async () => {
    const hexPubKey =
      "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";

    const res = await node.api.beacon.getStateValidator({stateId: "head", validatorId: hexPubKey});

    assert.equal(toHexString(res.value().validator.pubkey), hexPubKey);
  }
);

await env.tracker.assert("should return HTTP error responses in a spec compliant format", async () => {
  // ApiError with status 400 is thrown by handler
  const res1 = await node.api.beacon.getStateValidator({stateId: "current", validatorId: 1});
  assert.deepStrictEqual(JSON.parse(await res1.errorBody()), {code: 400, message: "Invalid block id 'current'"});

  // JSON schema validation failed
  const res2 = await node.api.beacon.getPoolAttestationsV2({slot: "current" as unknown as number, committeeIndex: 123});
  assert.deepStrictEqual(JSON.parse(await res2.errorBody()), {code: 400, message: "slot must be integer"});

  // Error processing multiple items
  const signedAttestations = Array.from({length: 3}, () => ssz.phase0.Attestation.defaultValue());
  const res3 = await node.api.beacon.submitPoolAttestationsV2({signedAttestations});
  const errBody = JSON.parse(await res3.errorBody()) as {code: number; message: string; failures: unknown[]};
  assert.equal(errBody.code, 400);
  assert.equal(errBody.message, "Error processing attestations");
  assert.equal(errBody.failures.length, signedAttestations.length);
  assert.deepStrictEqual(errBody.failures[0], {
    index: 0,
    message: "ATTESTATION_ERROR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET",
  });

  // Route does not exist
  const res4 = await fetch(`${node.restPublicUrl}/not/implemented/route`);
  assert.deepStrictEqual(JSON.parse(await res4.text()), {
    code: 404,
    message: "Route GET:/not/implemented/route not found",
  });
});

await env.tracker.assert("BN Not Synced", async () => {
  const expectedSyncStatus: routes.node.SyncingStatus = {
    headSlot: 2,
    syncDistance: 0,
    isSyncing: false,
    isOptimistic: false,
    elOffline: false,
  };

  const res = await node.api.node.getSyncingStatus();

  assert.deepEqual(res.value(), expectedSyncStatus);
});

await env.tracker.assert("Return READY pre genesis", async () => {
  const {status} = await node.api.node.getHealth();

  assert.equal(status, routes.node.NodeHealth.READY);
});

await env.stop();
