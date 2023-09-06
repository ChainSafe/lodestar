/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";
import {CLIQUE_SEALING_PERIOD, SIM_TESTS_SECONDS_PER_SLOT} from "../utils/simulation/constants.js";
import {AssertionMatch, BeaconClient, ExecutionClient, ValidatorClient} from "../utils/simulation/interfaces.js";
import {getEstimatedTTD, getEstimatedTimeInSecForRun, logFilesDir} from "../utils/simulation/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/simulation/utils/network.js";

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
    id: "mixed-clients",
    logsDir: path.join(logFilesDir, "mixed-clients"),
    chainConfig: {
      ALTAIR_FORK_EPOCH: altairForkEpoch,
      BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
      CAPELLA_FORK_EPOCH: capellaForkEpoch,
      GENESIS_DELAY: genesisDelaySeconds,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
    },
  },
  [
    {
      id: "node-1",
      execution: ExecutionClient.Geth,
      keysCount: 32,
      mining: true,
      beacon: BeaconClient.Lodestar,
      validator: ValidatorClient.Lighthouse,
    },
    {
      id: "node-2",
      execution: ExecutionClient.Geth,
      keysCount: 32,
      remote: true,
      beacon: BeaconClient.Lighthouse,
      validator: ValidatorClient.Lodestar,
    },
  ]
);

env.tracker.register({
  ...nodeAssertion,
  match: ({slot}) => {
    return slot === 1 ? AssertionMatch.Assert | AssertionMatch.Capture | AssertionMatch.Remove : AssertionMatch.None;
  },
});

await env.start({runTimeoutMs});
await connectAllNodes(env.nodes);

await waitForSlot(env.clock.getLastSlotOfEpoch(capellaForkEpoch + 1), env.nodes, {env, silent: true});

await env.stop();
