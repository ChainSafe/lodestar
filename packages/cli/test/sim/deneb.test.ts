import path from "node:path";
import {Simulation} from "../utils/crucible/simulation.js";
import {BeaconClient, ExecutionClient, ValidatorClient} from "../utils/crucible/interfaces.js";
import {defineSimTestConfig, logFilesDir} from "../utils/crucible/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/crucible/utils/network.js";
import {createBlobsAssertion} from "../utils/crucible/assertions/blobsAssertion.js";
import {assertCheckpointSync, assertRangeSync} from "../utils/crucible/utils/syncing.js";

const runTillEpoch = 6;
const syncWaitEpoch = 2;

const {estimatedTimeoutMs, forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  runTillEpoch: runTillEpoch + syncWaitEpoch,
  initialNodes: 2,
  additionalSlotsForTTD: 0,
});

const env = await Simulation.initWithDefaults(
  {
    id: "deneb",
    logsDir: path.join(logFilesDir, "deneb"),
    forkConfig,
    trustedSetup: true,
  },
  [
    {
      id: "node-1",
      beacon: BeaconClient.Lodestar,
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          clientOptions: {
            useProduceBlockV3: true,
          },
        },
      },
      execution: ExecutionClient.Geth,
      keysCount: 32,
      mining: true,
    },
    {
      id: "node-2",
      beacon: BeaconClient.Lodestar,
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          clientOptions: {
            useProduceBlockV3: true,
          },
        },
      },
      execution: ExecutionClient.Geth,
      keysCount: 32,
      remote: true,
    },
  ]
);

await env.start({runTimeoutMs: estimatedTimeoutMs});
await connectAllNodes(env.nodes);

env.tracker.register(
  createBlobsAssertion(env.nodes, {
    sendBlobsAtSlot: 2,
    validateBlobsAt: env.clock.getLastSlotOfEpoch(2),
  })
);

await waitForSlot("Waiting for the 2nd epoch to pass", {
  slot: env.clock.getLastSlotOfEpoch(2),
  env,
});

await assertRangeSync(env);
await assertCheckpointSync(env);

await env.stop();
