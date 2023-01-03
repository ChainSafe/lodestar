/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "node:path";
import {activePreset} from "@lodestar/params";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";
import {CLIQUE_SEALING_PERIOD, SIM_TESTS_SECONDS_PER_SLOT} from "../utils/simulation/constants.js";
import {CLClient, ELClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {getEstimatedTimeInSecForRun, getEstimatedTTD, logFilesDir} from "../utils/simulation/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/simulation/utils/network.js";

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
    id: "backup-eth-provider",
    logsDir: join(logFilesDir, "backup-eth-provider"),
    chainConfig: {
      ALTAIR_FORK_EPOCH: altairForkEpoch,
      BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
      GENESIS_DELAY: genesisSlotsDelay,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
    },
  },
  [
    {id: "node-1", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32, mining: true},
    {id: "node-2", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
  ]
);

env.tracker.register({
  ...nodeAssertion,
  match: ({slot}) => {
    return slot === 1 ? {match: true, remove: true} : false;
  },
});

const newNode = env.createNodePair({
  id: "node-3",
  cl: {type: CLClient.Lodestar, options: {engineUrls: [env.nodes[1].el.engineRpcUrl]}},
  el: ELClient.Geth,
  keysCount: 0,
});

env.nodes.push(newNode);

await env.start({runTimeoutMs});
await connectAllNodes(env.nodes);

await waitForSlot(env.clock.getLastSlotOfEpoch(1), env.nodes, {silent: true, env});

await newNode.el.job.stop();

// The `TTD` will be reach around `start of bellatrixForkEpoch + additionalSlotsForMerge` slot
// We wait for the end of that epoch with half more epoch to make sure merge transition is complete
await waitForSlot(env.clock.getLastSlotOfEpoch(bellatrixForkEpoch) + activePreset.SLOTS_PER_EPOCH / 2, env.nodes, {
  silent: true,
  env,
});

await env.stop();
