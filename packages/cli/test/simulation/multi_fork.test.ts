/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "node:path";
import {SIM_TESTS_SECONDS_PER_SLOT} from "../utils/simulation/constants.js";
import {CLClient, ELClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {getEstimatedTimeInSecForRun, logFilesDir} from "../utils/simulation/utils/index.js";
import {connectAllNodes} from "../utils/simulation/utils/network.js";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";
import {mergeAssertion} from "../utils/simulation/assertions/mergeAssertion.js";

const genesisSlotsDelay = 10;
const altairForkEpoch = 2;
const bellatrixForkEpoch = 4;
const runTillEpoch = 6;
const syncWaitEpoch = 2;

const timeout =
  getEstimatedTimeInSecForRun({
    genesisSlotDelay: genesisSlotsDelay,
    secondsPerSlot: SIM_TESTS_SECONDS_PER_SLOT,
    runTill: runTillEpoch + syncWaitEpoch,
    grace: 0.1, // 10% extra time
  }) * 1000;

const env = SimulationEnvironment.initWithDefaults(
  {
    id: "multi-fork",
    logsDir: join(logFilesDir, "multi-fork"),
    chainConfig: {
      ALTAIR_FORK_EPOCH: altairForkEpoch,
      BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
      GENESIS_DELAY: genesisSlotsDelay,
    },
  },
  [
    {id: "node-1", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
    {id: "node-2", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
    {id: "node-3", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
    {id: "node-4", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
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

await env.start(timeout);
await connectAllNodes(env.nodes);
await env.waitForSlot(env.clock.getLastSlotOfEpoch(bellatrixForkEpoch) + 2, env.nodes, true);
await env.stop();

// describe("sync from genesis", () => {
//   let rangeSync: NodePairResult;
//   let checkpointSync: NodePairResult;

//   before(async () => {
//     const {
//       data: {finalized},
//     } = await env.nodes[0].cl.api.beacon.getStateFinalityCheckpoints("head");

//     rangeSync = env.createNodePair({
//       id: "range-sync-node",
//       cl: CLClient.Lodestar,
//       el: ELClient.Geth,
//       keysCount: 0,
//     });

//     checkpointSync = env.createNodePair({
//       id: "checkpoint-sync-node",
//       cl: CLClient.Lodestar,
//       el: ELClient.Geth,
//       keysCount: 0,
//       wssCheckpoint: `${finalized.root}:${finalized.epoch}`,
//     });

//     await rangeSync.jobs.el.start();
//     await rangeSync.jobs.cl.start();
//     await connectNewNode(rangeSync.nodePair, env.nodes);

//     await checkpointSync.jobs.el.start();
//     await checkpointSync.jobs.cl.start();
//     await connectNewNode(checkpointSync.nodePair, env.nodes);
//   });

//   after(async () => {
//     await rangeSync.jobs.el.stop();
//     await rangeSync.jobs.cl.stop();
//     await checkpointSync.jobs.cl.stop();
//     await checkpointSync.jobs.cl.stop();
//   });

//   it("should sync the nodes", async () => {
//     await Promise.all([
//       nodeSyncedAssertions(env, rangeSync.nodePair, env.clock.getLastSlotOfEpoch(runTillEpoch + 1)),
//       nodeSyncedAssertions(env, checkpointSync.nodePair, env.clock.getLastSlotOfEpoch(runTillEpoch + 1)),
//     ]);
//   });
// });
