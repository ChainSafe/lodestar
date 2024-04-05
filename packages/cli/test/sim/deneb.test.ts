/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {activePreset} from "@lodestar/params";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";
import {AssertionMatch, BeaconClient, ExecutionClient} from "../utils/simulation/interfaces.js";
import {defineSimTestConfig, logFilesDir} from "../utils/simulation/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/simulation/utils/network.js";
import {assertRangeSync, assertCheckpointSync} from "../utils/simulation/utils/syncing.js";

const altairForkEpoch = 2;
const bellatrixForkEpoch = 4;
const runTillEpoch = 6;
const syncWaitEpoch = 2;

const {estimatedTimeoutMs, forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  runTillEpoch: runTillEpoch + syncWaitEpoch,
  initialNodes: 2,
});

const env = await SimulationEnvironment.initWithDefaults(
  {
    id: "deneb",
    logsDir: path.join(logFilesDir, "deneb"),
    forkConfig,
  },
  [
    {id: "node-1", beacon: BeaconClient.Lodestar, execution: ExecutionClient.Mock, keysCount: 32},
    {id: "node-2", beacon: BeaconClient.Lodestar, execution: ExecutionClient.Mock, keysCount: 32, remote: true},
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

// The `TTD` will be reach around `start of bellatrixForkEpoch + additionalSlotsForMerge` slot
// We wait for the end of that epoch with half more epoch to make sure merge transition is complete
await waitForSlot(env.clock.getLastSlotOfEpoch(bellatrixForkEpoch) + activePreset.SLOTS_PER_EPOCH / 2, env.nodes, {
  silent: true,
  env,
});

await assertRangeSync(env);
await assertCheckpointSync(env);

await env.stop();
