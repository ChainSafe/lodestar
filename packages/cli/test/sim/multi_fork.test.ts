/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "node:path";
import {activePreset} from "@lodestar/params";
import {toHexString} from "@lodestar/utils";
import {ApiError} from "@lodestar/api";
import {CLIQUE_SEALING_PERIOD, SIM_TESTS_SECONDS_PER_SLOT} from "../utils/simulation/constants.js";
import {CLClient, ELClient} from "../utils/simulation/interfaces.js";
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

const genesisSlotsDelay = 20;
const altairForkEpoch = 2;
const bellatrixForkEpoch = 4;
// Make sure bellatrix started before TTD reach
const additionalSlotsForTTD = activePreset.SLOTS_PER_EPOCH - 2;
const runTillEpoch = 6;
const syncWaitEpoch = 2;

const runTimeoutMs =
  getEstimatedTimeInSecForRun({
    genesisSlotDelay: genesisSlotsDelay,
    secondsPerSlot: SIM_TESTS_SECONDS_PER_SLOT,
    runTill: runTillEpoch + syncWaitEpoch,
    // After adding Nethermind its took longer to complete
    graceExtraTimeFraction: 0.3,
  }) * 1000;

const ttd = getEstimatedTTD({
  genesisDelay: genesisSlotsDelay,
  bellatrixForkEpoch: bellatrixForkEpoch,
  secondsPerSlot: SIM_TESTS_SECONDS_PER_SLOT,
  cliqueSealingPeriod: CLIQUE_SEALING_PERIOD,
  additionalSlots: additionalSlotsForTTD,
});

const env = SimulationEnvironment.initWithDefaults(
  {
    id: "multi-fork",
    logsDir: join(logFilesDir, "multi-fork"),
    chainConfig: {
      ALTAIR_FORK_EPOCH: altairForkEpoch,
      BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
      GENESIS_DELAY: genesisSlotsDelay,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
    },
  },
  [
    {id: "node-1", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32, mining: true},
    {id: "node-2", cl: CLClient.Lodestar, el: ELClient.Nethermind, keysCount: 32, remote: true},
    {id: "node-3", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
    {id: "node-4", cl: CLClient.Lodestar, el: ELClient.Nethermind, keysCount: 32},
  ]
);

env.tracker.register({
  ...nodeAssertion,
  match: ({slot}) => {
    return slot === 1 ? {match: true, remove: true} : false;
  },
});

env.tracker.register({
  ...mergeAssertion,
  match: ({slot}) => {
    // Check at the end of bellatrix fork, merge should happen by then
    return slot === env.clock.getLastSlotOfEpoch(bellatrixForkEpoch) - 1 ? {match: true, remove: true} : false;
  },
});

await env.start({runTimeoutMs});
await connectAllNodes(env.nodes);

// The `TTD` will be reach around `start of bellatrixForkEpoch + additionalSlotsForMerge` slot
// We wait for the end of that epoch with half more epoch to make sure merge transition is complete
await waitForSlot(env.clock.getLastSlotOfEpoch(bellatrixForkEpoch) + activePreset.SLOTS_PER_EPOCH / 2, env.nodes, {
  silent: true,
  env,
});

// Range Sync
// ========================================================
const headForRangeSync = await env.nodes[0].cl.api.beacon.getBlockHeader("head");
ApiError.assert(headForRangeSync);
const rangeSync = env.createNodePair({
  id: "range-sync-node",
  cl: CLClient.Lodestar,
  el: ELClient.Geth,
  keysCount: 0,
});

// Checkpoint sync involves Weak Subjectivity Checkpoint
// ========================================================
const res = await env.nodes[0].cl.api.beacon.getStateFinalityCheckpoints("head");
ApiError.assert(res);
const headForCheckpointSync = res.response.data.finalized;
const checkpointSync = env.createNodePair({
  id: "checkpoint-sync-node",
  cl: {
    type: CLClient.Lodestar,
    options: {clientOptions: {wssCheckpoint: `${headForCheckpointSync.root}:${headForCheckpointSync.epoch}`}},
  },
  el: ELClient.Geth,
  keysCount: 0,
});

await rangeSync.el.job.start();
await rangeSync.cl.job.start();
await connectNewNode(rangeSync, env.nodes);

await checkpointSync.el.job.start();
await checkpointSync.cl.job.start();
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

await rangeSync.cl.job.stop();
await rangeSync.el.job.stop();
await checkpointSync.cl.job.stop();
await checkpointSync.el.job.stop();

// Unknown block sync
// ========================================================
const unknownBlockSync = env.createNodePair({
  id: "unknown-block-sync-node",
  cl: {
    type: CLClient.Lodestar,
    options: {clientOptions: {"network.allowPublishToZeroPeers": true, "sync.disableRangeSync": true}},
  },
  el: ELClient.Geth,
  keysCount: 0,
});
await unknownBlockSync.el.job.start();
await unknownBlockSync.cl.job.start();
const headForUnknownBlockSync = await env.nodes[0].cl.api.beacon.getBlockV2("head");
ApiError.assert(headForUnknownBlockSync);
await connectNewNode(unknownBlockSync, env.nodes);

try {
  ApiError.assert(await unknownBlockSync.cl.api.beacon.publishBlock(headForUnknownBlockSync.response.data));

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
