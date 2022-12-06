/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "node:path";
import {activePreset} from "@lodestar/params";
import {toHexString} from "@lodestar/utils";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";
import {CLIQUE_SEALING_PERIOD, SIM_TESTS_SECONDS_PER_SLOT} from "../utils/simulation/constants.js";
import {CLClient, ELClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {getEstimatedTimeInSecForRun, getEstimatedTTD, logFilesDir} from "../utils/simulation/utils/index.js";
import {connectAllNodes, connectNewNode, waitForNodeSync, waitForSlot} from "../utils/simulation/utils/network.js";

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

const EIP4844_FORK_EPOCH = 1;
const env = SimulationEnvironment.initWithDefaults(
  {
    id: "multi-fork",
    logsDir: join(logFilesDir, "multi-fork"),
    chainConfig: {
      ALTAIR_FORK_EPOCH: altairForkEpoch,
      BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
      CAPELLA_FORK_EPOCH: 0,
      EIP4844_FORK_EPOCH: EIP4844_FORK_EPOCH,
      GENESIS_DELAY: genesisSlotsDelay,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
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

await env.start({runTimeoutMs});
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

await rangeSync.jobs.el.start();
await rangeSync.jobs.cl.start();
await connectNewNode(rangeSync.nodePair, env.nodes);

await checkpointSync.jobs.el.start();
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
await rangeSync.jobs.el.stop();
await checkpointSync.jobs.cl.stop();
await checkpointSync.jobs.el.stop();

await env.stop();
