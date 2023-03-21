/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {activePreset} from "@lodestar/params";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";
import {CLIQUE_SEALING_PERIOD, SIM_TESTS_SECONDS_PER_SLOT} from "../utils/simulation/constants.js";
import {CLClient, ELClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {
  getEstimatedTimeInSecForRun,
  getEstimatedTTD,
  logFilesDir,
  replaceIpFromUrl,
} from "../utils/simulation/utils/index.js";
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

const env = await SimulationEnvironment.initWithDefaults(
  {
    id: "backup-eth-provider",
    logsDir: path.join(logFilesDir, "backup-eth-provider"),
    chainConfig: {
      ALTAIR_FORK_EPOCH: altairForkEpoch,
      BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
      GENESIS_DELAY: genesisSlotsDelay,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
    },
  },
  [{id: "node-1", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32, mining: true}]
);

env.tracker.register({
  ...nodeAssertion,
  match: ({slot}) => {
    return slot === 1 ? {match: true, remove: true} : false;
  },
});

// Create node2 with additional engine url pointing to node1
const node2 = await env.createNodePair({
  id: "node-2",
  // As the Lodestar running on host and the geth running in docker container
  // we have to replace the IP with the local ip to connect to the geth
  cl: {type: CLClient.Lodestar, options: {engineUrls: [replaceIpFromUrl(env.nodes[0].el.engineRpcUrl, "127.0.0.1")]}},
  el: ELClient.Geth,
  keysCount: 32,
});

// Create node3 with additional engine url pointing to node1
const node3 = await env.createNodePair({
  id: "node-3",
  // As the Lodestar running on host and the geth running in docker container
  // we have to replace the IP with the local ip to connect to the geth
  cl: {type: CLClient.Lodestar, options: {engineUrls: [replaceIpFromUrl(env.nodes[0].el.engineRpcUrl, "127.0.0.1")]}},
  el: ELClient.Geth,
  keysCount: 0,
});

env.nodes.push(node2);
env.nodes.push(node3);

await env.start({runTimeoutMs});
await connectAllNodes(env.nodes);

await waitForSlot(env.clock.getLastSlotOfEpoch(1), env.nodes, {silent: true, env});

// Stop node2, node3 EL, so the only way they produce blocks is via node1 EL
await node2.el.job.stop();
await node3.el.job.stop();

// node2 and node3 will successfully reach TTD if they can communicate to an EL on node1
await waitForSlot(env.clock.getLastSlotOfEpoch(bellatrixForkEpoch) + activePreset.SLOTS_PER_EPOCH / 2, env.nodes, {
  silent: true,
  env,
});

await env.stop();
