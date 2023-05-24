/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {CLClient, ELClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {getEstimatedTTD, logFilesDir} from "../utils/simulation/utils/index.js";
import {connectAllNodes} from "../utils/simulation/utils/network.js";

const genesisSlotsDelay = 20;

const ttd = getEstimatedTTD({
  genesisDelaySeconds: genesisSlotsDelay * 6,
  bellatrixForkEpoch: 0,
  secondsPerSlot: 6,
  cliqueSealingPeriod: 5,
  additionalSlots: 5,
});

const env = await SimulationEnvironment.initWithDefaults(
  {
    id: "e2e-test-env",
    logsDir: path.join(logFilesDir, "e2e-test-env"),
    chainConfig: {
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      GENESIS_DELAY: genesisSlotsDelay,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
    },
  },
  [
    {id: "node-1", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32, mining: true},
    {id: "node-2", cl: CLClient.Lodestar, el: ELClient.Geth, keysCount: 32},
  ]
);

await env.start({runTimeoutMs: 0});
await connectAllNodes(env.nodes);
