/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {sleep, toHex, toHexString} from "@lodestar/utils";
import {ApiError} from "@lodestar/api";
import {CLIQUE_SEALING_PERIOD, SIM_TESTS_SECONDS_PER_SLOT} from "../utils/simulation/constants.js";
import {AssertionMatch, BeaconClient, ExecutionClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {getEstimatedTimeInSecForRun, getEstimatedTTD, logFilesDir} from "../utils/simulation/utils/index.js";
import {
  connectAllNodes,
  connectNewNode,
  waitForHead,
  waitForNodeSync,
  waitForSlot,
} from "../utils/simulation/utils/network.js";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";
import {mergeAssertion} from "../utils/simulation/assertions/mergeAssertion.js";
import {createForkAssertion} from "../utils/simulation/assertions/forkAssertion.js";

const genesisDelaySeconds = 20 * SIM_TESTS_SECONDS_PER_SLOT;
const altairForkEpoch = 2;
const bellatrixForkEpoch = 4;
const capellaForkEpoch = 6;
// Make sure bellatrix started before TTD reach
const additionalSlotsForTTD = 2;
const runTillEpoch = 8;
const syncWaitEpoch = 2;

const runTimeoutMs =
  getEstimatedTimeInSecForRun({
    genesisDelaySeconds,
    secondsPerSlot: SIM_TESTS_SECONDS_PER_SLOT,
    runTill: runTillEpoch + syncWaitEpoch,
    // After adding Nethermind its took longer to complete
    graceExtraTimeFraction: 0.3,
  }) * 1000;

const ttd = getEstimatedTTD({
  genesisDelaySeconds,
  bellatrixForkEpoch,
  secondsPerSlot: SIM_TESTS_SECONDS_PER_SLOT,
  cliqueSealingPeriod: CLIQUE_SEALING_PERIOD,
  additionalSlots: additionalSlotsForTTD,
});

const env = await SimulationEnvironment.initWithDefaults(
  {
    id: "multi-fork",
    logsDir: path.join(logFilesDir, "multi-fork"),
    chainConfig: {
      ALTAIR_FORK_EPOCH: altairForkEpoch,
      BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
      CAPELLA_FORK_EPOCH: capellaForkEpoch,
      GENESIS_DELAY: genesisDelaySeconds,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
    },
  },
  [
    {id: "node-1", beacon: BeaconClient.Lodestar, execution: ExecutionClient.Geth, keysCount: 32, mining: true},
    {id: "node-2", beacon: BeaconClient.Lodestar, execution: ExecutionClient.Nethermind, keysCount: 32, remote: true},
    {id: "node-3", beacon: BeaconClient.Lodestar, execution: ExecutionClient.Nethermind, keysCount: 32},
    {id: "node-4", beacon: BeaconClient.Lighthouse, execution: ExecutionClient.Geth, keysCount: 32},
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
    return slot === env.clock.getLastSlotOfEpoch(bellatrixForkEpoch) - 1
      ? AssertionMatch.Assert | AssertionMatch.Remove
      : AssertionMatch.None;
  },
});

await env.start({runTimeoutMs});
await connectAllNodes(env.nodes);

let lastForkEpoch = 0;
// Go through every fork and check which one is active and register assertion for it
// This will make sure this test would identify if we add new fork or activate one of the existing ones
for (const fork of env.forkConfig.forksAscendingEpochOrder) {
  if (!Number.isInteger(fork.epoch)) continue;
  lastForkEpoch = fork.epoch;
  env.tracker.register(createForkAssertion(fork.name, fork.epoch));
}

await waitForSlot(env.clock.getLastSlotOfEpoch(lastForkEpoch + 1), env.nodes, {
  env,
});

// Range Sync
// ========================================================
const headForRangeSync = await env.nodes[0].beacon.api.beacon.getBlockHeader("head");
ApiError.assert(headForRangeSync);
const rangeSync = await env.createNodePair({
  id: "range-sync-node",
  beacon: BeaconClient.Lodestar,
  execution: ExecutionClient.Geth,
  keysCount: 0,
});

// Checkpoint sync involves Weak Subjectivity Checkpoint
// ========================================================
const res = await env.nodes[0].beacon.api.beacon.getStateFinalityCheckpoints("head");
ApiError.assert(res);
const headForCheckpointSync = res.response.data.finalized;
const checkpointSync = await env.createNodePair({
  id: "checkpoint-sync-node",
  beacon: {
    type: BeaconClient.Lodestar,
    options: {clientOptions: {wssCheckpoint: `${toHex(headForCheckpointSync.root)}:${headForCheckpointSync.epoch}`}},
  },
  execution: ExecutionClient.Geth,
  keysCount: 0,
});

await rangeSync.execution.job.start();
await rangeSync.beacon.job.start();
await connectNewNode(rangeSync, env.nodes);

await checkpointSync.execution.job.start();
await checkpointSync.beacon.job.start();
await connectNewNode(checkpointSync, env.nodes);

await Promise.all([
  await waitForNodeSync(env, rangeSync, {
    head: toHexString(headForRangeSync.response.data.root),
    slot: headForRangeSync.response.data.header.message.slot,
  }),
  await waitForNodeSync(env, checkpointSync, {
    head: toHexString(headForCheckpointSync.root),
    slot: env.clock.getLastSlotOfEpoch(headForCheckpointSync.epoch),
  }),
]);

await rangeSync.beacon.job.stop();
await rangeSync.execution.job.stop();
await checkpointSync.beacon.job.stop();
await checkpointSync.execution.job.stop();

// Unknown block sync
// ========================================================
const unknownBlockSync = await env.createNodePair({
  id: "unknown-block-sync-node",
  beacon: {
    type: BeaconClient.Lodestar,
    options: {clientOptions: {"network.allowPublishToZeroPeers": true, "sync.disableRangeSync": true}},
  },
  execution: ExecutionClient.Geth,
  keysCount: 0,
});
await unknownBlockSync.execution.job.start();
await unknownBlockSync.beacon.job.start();
const headForUnknownBlockSync = await env.nodes[0].beacon.api.beacon.getBlockV2("head");
ApiError.assert(headForUnknownBlockSync);
await connectNewNode(unknownBlockSync, env.nodes);

// Wait for EL node to start and sync
await sleep(5000);

try {
  ApiError.assert(await unknownBlockSync.beacon.api.beacon.publishBlock(headForUnknownBlockSync.response.data));

  env.tracker.record({
    message: "Publishing unknown block should fail",
    slot: env.clock.currentSlot,
    assertionId: "unknownBlockParent",
  });
} catch (error) {
  if (!(error as Error).message.includes("BLOCK_ERROR_PARENT_UNKNOWN")) {
    env.tracker.record({
      message: `Publishing unknown block should return "BLOCK_ERROR_PARENT_UNKNOWN" got "${(error as Error).message}"`,
      slot: env.clock.currentSlot,
      assertionId: "unknownBlockParent",
    });
  }
}
await waitForHead(env, unknownBlockSync, {
  head: toHexString(
    env.forkConfig
      .getForkTypes(headForUnknownBlockSync.response.data.message.slot)
      .BeaconBlock.hashTreeRoot(headForUnknownBlockSync.response.data.message)
  ),
  slot: headForUnknownBlockSync.response.data.message.slot,
});

await env.stop();
