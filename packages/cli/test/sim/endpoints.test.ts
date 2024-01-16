/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {expect} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {ApiError, routes} from "@lodestar/api";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {BeaconClient, ExecutionClient} from "../utils/simulation/interfaces.js";
import {defineSimTestConfig, logFilesDir} from "../utils/simulation/utils/index.js";
import {waitForSlot} from "../utils/simulation/utils/network.js";

const altairForkEpoch = 2;
const bellatrixForkEpoch = 4;
const validatorCount = 2;

const {estimatedTimeoutMs, forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  runTillEpoch: 2,
});

const env = await SimulationEnvironment.initWithDefaults(
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
await waitForSlot(2, env.nodes, {env, silent: true});

const res = await node.api.beacon.getStateValidators("head");
ApiError.assert(res);
const stateValidators = res.response.data;

await env.tracker.assert("should have correct validators count called without filters", async () => {
  expect(stateValidators.length).toEqual(validatorCount);
});

await env.tracker.assert("should have correct validator index for first validator filters", async () => {
  expect(stateValidators[0].index).toEqual(0);
});

await env.tracker.assert("should have correct validator index for second validator filters", async () => {
  expect(stateValidators[1].index).toEqual(1);
});

await env.tracker.assert(
  "should return correct number of filtered validators when getStateValidators called with filters",
  async () => {
    const filterPubKey =
      "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";

    const res = await node.api.beacon.getStateValidators("head", {
      id: [filterPubKey],
    });
    ApiError.assert(res);

    expect(res.response.data.length).toEqual(1);
  }
);

await env.tracker.assert(
  "should return correct filtered validators when getStateValidators called with filters",
  async () => {
    const filterPubKey =
      "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";

    const res = await node.api.beacon.getStateValidators("head", {
      id: [filterPubKey],
    });
    ApiError.assert(res);

    expect(toHexString(res.response.data[0].validator.pubkey)).toEqual(filterPubKey);
  }
);

await env.tracker.assert(
  "should return the validator when getStateValidator is called with the validator index",
  async () => {
    const validatorIndex = 0;

    const res = await node.api.beacon.getStateValidator("head", validatorIndex);
    ApiError.assert(res);

    expect(res.response.data.index).toEqual(validatorIndex);
  }
);

await env.tracker.assert(
  "should return the validator when getStateValidator is called with the hex encoded public key",
  async () => {
    const hexPubKey =
      "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";

    const res = await node.api.beacon.getStateValidator("head", hexPubKey);
    ApiError.assert(res);

    expect(toHexString(res.response.data.validator.pubkey)).toEqual(hexPubKey);
  }
);

await env.tracker.assert("BN Not Synced", async () => {
  const expectedSyncStatus: routes.node.SyncingStatus = {
    headSlot: "2",
    syncDistance: "0",
    isSyncing: false,
    isOptimistic: false,
    elOffline: false,
  };

  const res = await node.api.node.getSyncingStatus();
  ApiError.assert(res);

  expect(res.response.data).toEqual(expectedSyncStatus);
});

await env.tracker.assert("Return READY pre genesis", async () => {
  const {status} = await node.api.node.getHealth();

  expect(status).toEqual(routes.node.NodeHealth.READY);
});

await env.stop();
