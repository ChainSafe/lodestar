import path from "node:path";
import {nodeAssertion} from "../utils/crucible/assertions/nodeAssertion.js";
import {BeaconClient, ExecutionClient, Match, ValidatorClient} from "../utils/crucible/interfaces.js";
import {Simulation} from "../utils/crucible/simulation.js";
import {defineSimTestConfig, logFilesDir} from "../utils/crucible/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/crucible/utils/network.js";

const altairForkEpoch = 0;
const bellatrixForkEpoch = 0;
const capellaForkEpoch = 0;
const denebForkEpoch = 0;
const electraForkEpoch = 0;
const fuluForkEpoch = Infinity;
const runTillEpoch = 4;

const {estimatedTimeoutMs, forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  CAPELLA_FORK_EPOCH: capellaForkEpoch,
  DENEB_FORK_EPOCH: denebForkEpoch,
  ELECTRA_FORK_EPOCH: electraForkEpoch,
  FULU_FORK_EPOCH: fuluForkEpoch,
  runTillEpoch: runTillEpoch,
  additionalSlotsForTTD: 0,
  initialNodes: 2,
});

const env = await Simulation.initWithDefaults(
  {
    id: "mixed-clients",
    logsDir: path.join(logFilesDir, "mixed-clients"),
    forkConfig,
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
      validator: {
        type: ValidatorClient.Lodestar,
        options: {},
      },
    },
  ]
);

env.tracker.register({
  ...nodeAssertion,
  match: ({slot}) => {
    return slot === 1 ? Match.Assert | Match.Capture | Match.Remove : Match.None;
  },
});

await env.start({runTimeoutMs: estimatedTimeoutMs});
await connectAllNodes(env.nodes);

// Stopping at last slot usually cause assertion to fail because of missing data as node are shutting down
await waitForSlot("Waiting for the one additional epoch for capellaFork", {
  slot: env.clock.getLastSlotOfEpoch(capellaForkEpoch + 1) + 2,
  env,
});

await env.stop();
