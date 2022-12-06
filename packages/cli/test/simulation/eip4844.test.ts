/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import fs from "node:fs";
import {activePreset} from "@lodestar/params";
import {toHexString} from "@lodestar/utils";
import {SIM_TESTS_SECONDS_PER_SLOT} from "../utils/simulation/constants.js";
import {CLClient, ELClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {getEstimatedTimeInSecForRun, logFilesDir} from "../utils/simulation/utils/index.js";
import {
  connectAllNodes,
  connectNewNode,
  waitForHead,
  waitForNodeSync,
  waitForSlot,
} from "../utils/simulation/utils/network.js";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";

// To run in "debug" mode
// ```
// lodestar/packages/cli$ (cd ../../ && yarn build:ifchanged) && ../../node_modules/.bin/ts-node --esm test/simulation/eip4844.test.ts
// ```

const genesisSlotsDelay = 8;
// Make sure bellatrix started before TTD reach
const runTillEpoch = 6;
const syncWaitEpoch = 2;
const EIP4844_FORK_EPOCH = 1;

const logsDir = path.resolve(logFilesDir, "multi-fork");
fs.rmSync(logsDir, {recursive: true});
// eslint-disable-next-line no-console
console.log("logsDir", logsDir);

const env = SimulationEnvironment.initWithDefaults(
  {
    id: "multi-fork",
    logsDir,
    chainConfig: {
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      EIP4844_FORK_EPOCH: EIP4844_FORK_EPOCH,
      GENESIS_DELAY: genesisSlotsDelay,
      TERMINAL_TOTAL_DIFFICULTY: BigInt(0),
    },
  },
  [
    {id: "node-1", cl: CLClient.Lodestar, el: ELClient.Mock, keysCount: 32},
    {id: "node-2", cl: CLClient.Lodestar, el: ELClient.Mock, keysCount: 32},
    // {id: "node-3", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
    // {id: "node-4", cl: CLClient.Lodestar, el: ELClient.Nethermind, keysCount: 32},
  ]
);

env.tracker.register({
  ...nodeAssertion,
  match: ({slot}) => {
    return slot === 1 ? {match: true, remove: true} : false;
  },
});

await env.start({
  runTimeoutMs:
    getEstimatedTimeInSecForRun({
      genesisSlotDelay: genesisSlotsDelay,
      secondsPerSlot: SIM_TESTS_SECONDS_PER_SLOT,
      runTill: runTillEpoch + syncWaitEpoch,
      // After adding Nethermind its took longer to complete
      graceExtraTimeFraction: 0.3,
    }) * 1000,
});
await connectAllNodes(env.nodes);

// The `TTD` will be reach around `start of bellatrixForkEpoch + additionalSlotsForMerge` slot
// We wait for the end of that epoch with half more epoch to make sure merge transition is complete
await waitForSlot(env.clock.getLastSlotOfEpoch(EIP4844_FORK_EPOCH + 2) + activePreset.SLOTS_PER_EPOCH / 2, env.nodes, {
  silent: true,
  env,
});

// Range Sync
// ========================================================
const headForRangeSync = await env.nodes[0].cl.api.beacon.getBlockHeader("head");
const rangeSync = env.createNodePair({
  id: "range-sync-node",
  cl: CLClient.Lodestar,
  el: ELClient.Mock,
  keysCount: 0,
});

// Checkpoint sync involves Weak Subjectivity Checkpoint
// ========================================================
const {
  data: {finalized: headForCheckpointSync},
} = await env.nodes[0].cl.api.beacon.getStateFinalityCheckpoints("head");
const checkpointSync = env.createNodePair({
  id: "checkpoint-sync-node",
  cl: {
    type: CLClient.Lodestar,
    options: {wssCheckpoint: `${headForCheckpointSync.root}:${headForCheckpointSync.epoch}`},
  },
  el: ELClient.Mock,
  keysCount: 0,
});

await rangeSync.jobs.el?.start();
await rangeSync.jobs.cl.start();
await connectNewNode(rangeSync.nodePair, env.nodes);

await checkpointSync.jobs.el?.start();
await checkpointSync.jobs.cl.start();
await connectNewNode(checkpointSync.nodePair, env.nodes);

await Promise.all([
  await waitForNodeSync(env, rangeSync.nodePair, {
    head: toHexString(headForRangeSync.data.root),
    slot: headForRangeSync.data.header.message.slot,
  }),
  await waitForNodeSync(env, checkpointSync.nodePair, {
    head: toHexString(headForCheckpointSync.root),
    slot: env.clock.getLastSlotOfEpoch(headForCheckpointSync.epoch),
  }),
]);

await rangeSync.jobs.cl.stop();
await rangeSync.jobs.el?.stop();
await checkpointSync.jobs.cl.stop();
await checkpointSync.jobs.el?.stop();

// Unknown block sync
// ========================================================
const unknownBlockSync = env.createNodePair({
  id: "unknown-block-sync-node",
  cl: {type: CLClient.Lodestar, options: {"network.allowPublishToZeroPeers": true, "sync.disableRangeSync": true}},
  el: ELClient.Mock,
  keysCount: 0,
});
await unknownBlockSync.jobs.el?.start();
await unknownBlockSync.jobs.cl.start();
const headForUnknownBlockSync = await env.nodes[0].cl.api.beacon.getBlockV2("head");
await connectNewNode(unknownBlockSync.nodePair, env.nodes);

try {
  await unknownBlockSync.nodePair.cl.api.beacon.publishBlock(headForUnknownBlockSync.data);

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
await waitForHead(env, unknownBlockSync.nodePair, {
  head: toHexString(
    env.forkConfig
      .getForkTypes(headForUnknownBlockSync.data.message.slot)
      .BeaconBlock.hashTreeRoot(headForUnknownBlockSync.data.message)
  ),
  slot: headForUnknownBlockSync.data.message.slot,
});

await env.stop();
