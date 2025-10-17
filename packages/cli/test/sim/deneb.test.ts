import path from "node:path";
import {createBlobsAssertion} from "../utils/crucible/assertions/blobsAssertion.js";
import {Simulation} from "../utils/crucible/kurtosis/simulation/simulation-kurtosis.js";
import {defineSimTestConfig, logFilesDir} from "../utils/crucible/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/crucible/utils/network.js";
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

const env = await Simulation.initWithKurtosisConfig(
  {
    id: "deneb",
    logsDir: path.join(logFilesDir, "deneb"),
    forkConfig,
  },
  "deneb.yml"
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
