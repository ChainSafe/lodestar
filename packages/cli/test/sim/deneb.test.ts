/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {Simulation} from "../utils/crucible/simulation.js";
import {BeaconClient, ExecutionClient, ValidatorClient} from "../utils/crucible/interfaces.js";
import {defineSimTestConfig, logFilesDir} from "../utils/crucible/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/crucible/utils/network.js";
import {createBlobsAssertion} from "../utils/crucible/assertions/blobsAssertion.js";
import {assertCheckpointSync, assertRangeSync} from "../utils/crucible/utils/syncing.js";

const genesisDelaySeconds = 20 * SIM_TESTS_SECONDS_PER_SLOT;
const altairForkEpoch = 1;
const bellatrixForkEpoch = 2;
const capellaForkEpoch = 3;
const denebForkEpoch = 4;
// Make sure bellatrix started before TTD reach
const additionalSlotsForTTD = activePreset.SLOTS_PER_EPOCH - 2;
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
    // TODO: (@matthewkeil) this may be a merge conflict
    forkConfig,
    trustedSetup: true,
    chainConfig: {
      ALTAIR_FORK_EPOCH: altairForkEpoch,
      BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
      CAPELLA_FORK_EPOCH: capellaForkEpoch,
      DENEB_FORK_EPOCH: denebForkEpoch,
      GENESIS_DELAY: genesisDelaySeconds,
      TERMINAL_TOTAL_DIFFICULTY: ttd,
    },
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
