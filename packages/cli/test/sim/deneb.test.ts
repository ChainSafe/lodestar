/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {ApiError} from "@lodestar/api";
import {activePreset} from "@lodestar/params";
import {toHex, toHexString} from "@lodestar/utils";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";
import {AssertionMatch, BeaconClient, ExecutionClient} from "../utils/simulation/interfaces.js";
import {defineSimTestConfig, logFilesDir} from "../utils/simulation/utils/index.js";
import {connectAllNodes, connectNewNode, waitForNodeSync, waitForSlot} from "../utils/simulation/utils/network.js";

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

// Range Sync
// ========================================================
const headForRangeSync = await env.nodes[0].beacon.api.beacon.getBlockHeader("head");
ApiError.assert(headForRangeSync);
const rangeSync = await env.createNodePair({
  id: "range-sync-node",
  beacon: BeaconClient.Lodestar,
  execution: ExecutionClient.Geth,
  keysCount: 0,
});

// Checkpoint sync involves Weak Subjectivity Checkpoint
// ========================================================
const res = await env.nodes[0].beacon.api.beacon.getStateFinalityCheckpoints("head");
ApiError.assert(res);
const headForCheckpointSync = res.response.data.finalized;
const checkpointSync = await env.createNodePair({
  id: "checkpoint-sync-node",
  beacon: {
    type: BeaconClient.Lodestar,
    options: {clientOptions: {wssCheckpoint: `${toHex(headForCheckpointSync.root)}:${headForCheckpointSync.epoch}`}},
  },
  execution: ExecutionClient.Geth,
  keysCount: 0,
});

await rangeSync.execution.job.start();
await rangeSync.beacon.job.start();
await connectNewNode(rangeSync, env.nodes);

await checkpointSync.execution.job.start();
await checkpointSync.beacon.job.start();
await connectNewNode(checkpointSync, env.nodes);

await Promise.all([
  await waitForNodeSync(env, rangeSync, {
    head: toHexString(headForRangeSync.response.data.root),
    slot: headForRangeSync.response.data.header.message.slot,
  }),
  await waitForNodeSync(env, checkpointSync, {
    head: toHexString(headForCheckpointSync.root),
    slot: env.clock.getLastSlotOfEpoch(headForCheckpointSync.epoch),
  }),
]);

await rangeSync.beacon.job.stop();
await rangeSync.execution.job.stop();
await checkpointSync.beacon.job.stop();
await checkpointSync.execution.job.stop();

await env.stop();
