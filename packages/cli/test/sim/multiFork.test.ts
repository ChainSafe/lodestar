/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {AssertionMatch, BeaconClient, ExecutionClient, ValidatorClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/simulationEnvironment.js";
import {defineSimTestConfig, logFilesDir} from "../utils/simulation/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/simulation/utils/network.js";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";
import {mergeAssertion} from "../utils/simulation/assertions/mergeAssertion.js";
import {createForkAssertion} from "../utils/simulation/assertions/forkAssertion.js";
import {createAccountBalanceAssertion} from "../utils/simulation/assertions/accountBalanceAssertion.js";
import {createExecutionHeadAssertion} from "../utils/simulation/assertions/executionHeadAssertion.js";
import {createWithdrawalAssertions} from "../utils/simulation/assertions/withdrawalsAssertion.js";
import {assertCheckpointSync, assertRangeSync, assertUnknownBlockSync} from "../utils/simulation/utils/syncing.js";

const altairForkEpoch = 2;
const bellatrixForkEpoch = 4;
const capellaForkEpoch = 6;
const denebForkEpoch = 8;
const runTillEpoch = 10;
const syncWaitEpoch = 2;

const {estimatedTimeoutMs, forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  CAPELLA_FORK_EPOCH: capellaForkEpoch,
  DENEB_FORK_EPOCH: denebForkEpoch,
  runTillEpoch: runTillEpoch + syncWaitEpoch,
  initialNodes: 5,
});

const env = await SimulationEnvironment.initWithDefaults(
  {
    id: "multi-fork",
    logsDir: path.join(logFilesDir, "multi-fork"),
    forkConfig,
  },
  [
    // put 1 lodestar node on produceBlockV3, and 2nd on produceBlindedBlock and 3rd on produceBlockV2
    // specifying the useProduceBlockV3 options despite whatever default is set
    {
      id: "node-1",
      beacon: BeaconClient.Lodestar,
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          // this will cause race in beacon but since builder is not attached will
          // return with engine full block and publish via publishBlockV2
          clientOptions: {
            useProduceBlockV3: true,
            "builder.selection": "maxprofit",
          },
        },
      },
      execution: ExecutionClient.Geth,
      keysCount: 32,
      mining: true,
    },
    {
      id: "node-2",
      beacon: BeaconClient.Lodestar,
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          // this will make the beacon respond with blinded version of the local block as no
          // builder is attached to beacon, and publish via publishBlindedBlockV2
          clientOptions: {
            useProduceBlockV3: true,
            "builder.selection": "maxprofit",
            blindedLocal: true,
          },
        },
      },
      execution: ExecutionClient.Geth,
      keysCount: 32,
      remote: true,
    },
    {
      id: "node-3",
      beacon: BeaconClient.Lodestar,
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          // this builder selection will make it use produceBlockV2 and respond with full block
          clientOptions: {
            useProduceBlockV3: false,
            "builder.selection": "executiononly",
          },
        },
      },
      execution: ExecutionClient.Geth,
      keysCount: 32,
    },
    {
      id: "node-4",
      beacon: BeaconClient.Lodestar,
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          // this builder selection will make it use produceBlindedBlockV2 and respond with blinded version
          // of local block and subsequent publishing via publishBlindedBlock
          clientOptions: {
            useProduceBlockV3: false,
            "builder.selection": "maxprofit",
          },
        },
      },
      execution: ExecutionClient.Geth,
      keysCount: 32,
    },
    {id: "node-5", beacon: BeaconClient.Lighthouse, execution: ExecutionClient.Geth, keysCount: 32},
  ]
);

env.tracker.register({
  ...nodeAssertion,
  match: ({slot}) => {
    return slot === 1 ? AssertionMatch.Assert | AssertionMatch.Capture | AssertionMatch.Remove : AssertionMatch.None;
  },
});

env.tracker.register({
  ...mergeAssertion,
  match: ({slot}) => {
    // Check at the end of bellatrix fork, merge should happen by then
    return slot === env.clock.getLastSlotOfEpoch(bellatrixForkEpoch)
      ? AssertionMatch.Assert | AssertionMatch.Remove
      : AssertionMatch.None;
  },
});

env.tracker.register(
  createAccountBalanceAssertion({
    address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sendTransactionsAtSlot: [
      env.clock.getFirstSlotOfEpoch(altairForkEpoch) + 4,
      env.clock.getFirstSlotOfEpoch(bellatrixForkEpoch) + 4,
    ],
    validateTotalBalanceAt: [env.clock.getFirstSlotOfEpoch(bellatrixForkEpoch + 1) + 4],
    targetNode: env.nodes[0],
  })
);

env.tracker.register(
  createExecutionHeadAssertion({
    // Second last slot of second bellatrix epoch
    checkForSlot: [env.clock.getLastSlotOfEpoch(bellatrixForkEpoch + 1) - 1],
  })
);

env.tracker.register(createWithdrawalAssertions(env.nodes[0].id));

await env.start({runTimeoutMs: estimatedTimeoutMs});
await connectAllNodes(env.nodes);

let lastForkEpoch = 0;
// Go through every fork and check which one is active and register assertion for it
// This will make sure this test would identify if we add new fork or activate one of the existing ones
for (const fork of env.forkConfig.forksAscendingEpochOrder) {
  if (!Number.isInteger(fork.epoch)) continue;
  lastForkEpoch = fork.epoch;
  env.tracker.register(createForkAssertion(fork.name, fork.epoch));
}

await waitForSlot("Waiting for last forks to pass", {
  slot: env.clock.getLastSlotOfEpoch(lastForkEpoch + 1),
  env,
});

await assertRangeSync(env);
await assertCheckpointSync(env);
await assertUnknownBlockSync(env);

await env.stop();
