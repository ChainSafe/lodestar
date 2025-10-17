import path from "node:path";
import {createAccountBalanceAssertion} from "../utils/crucible/assertions/accountBalanceAssertion.js";
import {createExecutionHeadAssertion} from "../utils/crucible/assertions/executionHeadAssertion.js";
import {createForkAssertion} from "../utils/crucible/assertions/forkAssertion.js";
import {mergeAssertion} from "../utils/crucible/assertions/mergeAssertion.js";
import {nodeAssertion} from "../utils/crucible/assertions/nodeAssertion.js";
import {createWithdrawalAssertions} from "../utils/crucible/assertions/withdrawalsAssertion.js";
import {Match} from "../utils/crucible/interfaces.js";
import {Simulation} from "../utils/crucible/kurtosis/simulation/simulation-kurtosis.js";
import {defineSimTestConfig, logFilesDir} from "../utils/crucible/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/crucible/utils/network.js";
import {assertCheckpointSync, assertRangeSync, assertUnknownBlockSync} from "../utils/crucible/utils/syncing.js";

const altairForkEpoch = 0;
const bellatrixForkEpoch = 0;
const capellaForkEpoch = 0;
const denebForkEpoch = 0;
const runTillEpoch = 4;
const syncWaitEpoch = 2;

const {estimatedTimeoutMs, forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  CAPELLA_FORK_EPOCH: capellaForkEpoch,
  DENEB_FORK_EPOCH: denebForkEpoch,
  runTillEpoch: runTillEpoch + syncWaitEpoch,
  initialNodes: 5,
});


// Load configuration and create simulation (services not started yet)
const env = await Simulation.initWithKurtosisConfig(
  {
    id: "multi-fork",
    logsDir: path.join(logFilesDir, "multi-fork"),
    forkConfig,
  },
  "multi-fork.yml"  // Kurtosis network configuration
);

env.tracker.register({
  ...nodeAssertion,
  match: ({slot}) => {
    return slot === 1 ? Match.Assert | Match.Capture | Match.Remove : Match.None;
  },
});

env.tracker.register({
  ...mergeAssertion,
  match: ({slot}) => {
    // Check at the end of bellatrix fork, merge should happen by then
    return slot === env.clock.getLastSlotOfEpoch(bellatrixForkEpoch) ? Match.Assert | Match.Remove : Match.None;
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
