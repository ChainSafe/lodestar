/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {sleep, toHexString} from "@lodestar/utils";
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
    {id: "node-1", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32, mining: true},
    {id: "node-2", cl: CLClient.Lodestar, el: ELClient.Nethermind, keysCount: 32, remote: true},
    {id: "node-3", cl: CLClient.Lodestar, el: ELClient.Nethermind, keysCount: 32},
    {id: "node-4", cl: CLClient.Lighthouse, el: ELClient.Geth, keysCount: 32},
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

for (const fork of env.forkConfig.forksAscendingEpochOrder) {
  env.tracker.register({
    id: `fork-${fork.name}`,
    assert: async ({nodes, slot}) => {
      const errors: string[] = [];
      for (const node of nodes) {
        const res = await node.cl.api.debug.getStateV2("head");
        ApiError.assert(res);
        const expectedForkVersion = toHexString(env.forkConfig.getForkInfo(slot).version);
        const currentForkVersion = toHexString(res.response.data.fork.currentVersion);

        if (expectedForkVersion !== currentForkVersion) {
          errors.push(
            `Node is not on correct fork. ${JSON.stringify({
              id: node.cl.id,
              slot,
              fork: fork.name,
              expectedForkVersion,
              currentForkVersion,
            })}`
          );
        }
      }

      return errors;
    },
    match: ({slot}) => {
      return slot === env.clock.getFirstSlotOfEpoch(fork.epoch) ? {match: true, remove: true} : false;
    },
  });
}

await waitForSlot(env.clock.getLastSlotOfEpoch(env.forkConfig.forksDescendingEpochOrder[0].epoch + 1), env.nodes, {
  env,
});

// Range Sync
// ========================================================
const headForRangeSync = await env.nodes[0].cl.api.beacon.getBlockHeader("head");
ApiError.assert(headForRangeSync);
const rangeSync = await env.createNodePair({
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
const checkpointSync = await env.createNodePair({
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
const unknownBlockSync = await env.createNodePair({
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

// Wait for EL node to start and sync
await sleep(5000);

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
