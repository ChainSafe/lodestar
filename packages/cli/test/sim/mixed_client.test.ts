/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";
import {AssertionMatch, BeaconClient, ExecutionClient, ValidatorClient} from "../utils/simulation/interfaces.js";
import {defineSimTestConfig, logFilesDir} from "../utils/simulation/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/simulation/utils/network.js";

const altairForkEpoch = 2;
const bellatrixForkEpoch = 4;
const capellaForkEpoch = 6;
const runTillEpoch = 8;
const syncWaitEpoch = 2;

const {estimatedTimeoutMs, forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  CAPELLA_FORK_EPOCH: capellaForkEpoch,
  runTillEpoch: runTillEpoch + syncWaitEpoch,
  initialNodes: 2,
});

const env = await SimulationEnvironment.initWithDefaults(
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
      // for cross client make sure lodestar doesn't use v3 for now untill lighthouse supports
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          clientOptions: {
            useProduceBlockV3: false,
            // this should cause usage of produceBlockV2
            //
            // but if blinded production is enabled in lighthouse beacon then this should cause
            // usage of produce blinded block which should return execution block in blinded format
            // but only enable that after testing lighthouse beacon
            "builder.selection": "executiononly",
          },
        },
      },
    },
  ]
);

env.tracker.register({
  ...nodeAssertion,
  match: ({slot}) => {
    return slot === 1 ? AssertionMatch.Assert | AssertionMatch.Capture | AssertionMatch.Remove : AssertionMatch.None;
  },
});

await env.start({runTimeoutMs: estimatedTimeoutMs});
await connectAllNodes(env.nodes);

// Stopping at last slot usually cause assertion to fail because of missing data as node are shutting down
await waitForSlot(env.clock.getLastSlotOfEpoch(capellaForkEpoch + 1) + 2, env.nodes, {env, silent: true});

await env.stop();
