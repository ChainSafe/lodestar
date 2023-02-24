/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {expect} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {ApiError} from "@lodestar/api";
import {CLClient, ELClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {getEstimatedTimeInSecForRun, logFilesDir} from "../utils/simulation/utils/index.js";
import {waitForSlot} from "../utils/simulation/utils/network.js";
import {SIM_TESTS_SECONDS_PER_SLOT} from "../utils/simulation/constants.js";

const genesisSlotsDelay = 10;
const altairForkEpoch = 2;
const bellatrixForkEpoch = 4;
const validatorCount = 2;
const runTimeoutMs =
  getEstimatedTimeInSecForRun({
    genesisSlotDelay: genesisSlotsDelay,
    secondsPerSlot: SIM_TESTS_SECONDS_PER_SLOT,
    runTill: 2,
    // After adding Nethermind its took longer to complete
    graceExtraTimeFraction: 0.1,
  }) * 1000;

const env = await SimulationEnvironment.initWithDefaults(
  {
    id: "beacon-endpoints",
    logsDir: path.join(logFilesDir, "beacon-endpoints"),
    chainConfig: {
      ALTAIR_FORK_EPOCH: altairForkEpoch,
      BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
      GENESIS_DELAY: genesisSlotsDelay,
    },
  },
  [
    {
      id: "node-1",
      cl: {type: CLClient.Lodestar, options: {clientOptions: {"sync.isSingleNode": true}}},
      el: ELClient.Geth,
      keysCount: validatorCount,
      mining: true,
    },
  ]
);
await env.start({runTimeoutMs});

const node = env.nodes[0].cl;
await waitForSlot(2, env.nodes, {env, silent: true});

const res = await node.api.beacon.getStateValidators("head");
ApiError.assert(res);
const stateValidators = res.response.data;

await env.tracker.assert("should have correct validators count called without filters", async () => {
  expect(stateValidators.length).to.be.equal(validatorCount);
});

await env.tracker.assert("should have correct validator index for first validator filters", async () => {
  expect(stateValidators[0].index).to.be.equal(0);
});

await env.tracker.assert("should have correct validator index for second validator filters", async () => {
  expect(stateValidators[1].index).to.be.equal(1);
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

    expect(res.response.data.length).to.be.equal(1);
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

    expect(toHexString(res.response.data[0].validator.pubkey)).to.be.equal(filterPubKey);
  }
);

await env.tracker.assert(
  "should return the validator when getStateValidator is called with the validator index",
  async () => {
    const validatorIndex = 0;

    const res = await node.api.beacon.getStateValidator("head", validatorIndex);
    ApiError.assert(res);

    expect(res.response.data.index).to.be.equal(validatorIndex);
  }
);

await env.tracker.assert(
  "should return the validator when getStateValidator is called with the hex encoded public key",
  async () => {
    const hexPubKey =
      "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";

    const res = await node.api.beacon.getStateValidator("head", hexPubKey);
    ApiError.assert(res);

    expect(toHexString(res.response.data.validator.pubkey)).to.be.equal(hexPubKey);
  }
);

await env.tracker.assert("BN Not Synced", async () => {
  const expectedSyncStatus: routes.node.SyncingStatus = {
    headSlot: "2",
    syncDistance: "0",
    isSyncing: false,
    isOptimistic: false,
  };

  const res = await node.api.node.getSyncingStatus();
  ApiError.assert(res);

  expect(res.response.data).to.be.deep.equal(expectedSyncStatus);
});

await env.tracker.assert("Return READY pre genesis", async () => {
  const {status} = await node.api.node.getHealth();

  expect(status).to.be.equal(routes.node.NodeHealth.READY);
});

await env.stop();
