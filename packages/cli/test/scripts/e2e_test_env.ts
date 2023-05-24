/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {CLClient, ELClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {getEstimatedTTD, logFilesDir} from "../utils/simulation/utils/index.js";
import {connectAllNodes} from "../utils/simulation/utils/network.js";

const secondsPerSlot = 4;
const cliqueSealingPeriod = 5;
const genesisDelaySeconds = 20 * secondsPerSlot;
const altairForkEpoch = 0;
const bellatrixForkEpoch = 0;
const capellaForkEpoch = 0;
// Make sure bellatrix started before TTD reach
const additionalSlotsForTTD = 2;

const ttd = getEstimatedTTD({
  genesisDelaySeconds,
  bellatrixForkEpoch,
  secondsPerSlot,
  cliqueSealingPeriod,
  additionalSlots: additionalSlotsForTTD,
});

const env = await SimulationEnvironment.initWithDefaults(
  {
    id: "e2e-test-env",
    logsDir: path.join(logFilesDir, "e2e-test-env"),
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
    {id: "node-2", cl: CLClient.Lodestar, el: ELClient.Nethermind, keysCount: 32},
  ]
);

await env.start({runTimeoutMs: 0});
await connectAllNodes(env.nodes);
