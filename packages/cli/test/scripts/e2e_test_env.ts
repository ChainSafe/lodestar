import path from "node:path";
import {BeaconClient, ExecutionClient} from "../utils/crucible/interfaces.js";
import {Simulation} from "../utils/crucible/simulation.js";
import {defineSimTestConfig, logFilesDir} from "../utils/crucible/utils/index.js";
import {connectAllNodes} from "../utils/crucible/utils/network.js";

const altairForkEpoch = 1;
const bellatrixForkEpoch = 2;
const capellaForkEpoch = 3;

const {forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  CAPELLA_FORK_EPOCH: capellaForkEpoch,
  runTillEpoch: Infinity,
  initialNodes: 2,
});

const env = await Simulation.initWithDefaults(
  {
    id: "e2e-test-env",
    logsDir: path.join(logFilesDir, "e2e-test-env"),
    forkConfig,
  },
  [
    {id: "node-1", beacon: BeaconClient.Lodestar, execution: ExecutionClient.Geth, keysCount: 32, mining: true},
    {id: "node-2", beacon: BeaconClient.Lodestar, execution: ExecutionClient.Geth, keysCount: 32},
  ]
);

await env.start({runTimeoutMs: 0});
await connectAllNodes(env.nodes);
