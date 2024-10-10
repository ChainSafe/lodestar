import path from "node:path";
import {activePreset} from "@lodestar/params";
import {Simulation} from "../utils/crucible/simulation.js";
import {nodeAssertion} from "../utils/crucible/assertions/nodeAssertion.js";
import {Match, BeaconClient, ExecutionClient} from "../utils/crucible/interfaces.js";
import {defineSimTestConfig, logFilesDir, replaceIpFromUrl} from "../utils/crucible/utils/index.js";
import {connectAllNodes, waitForSlot} from "../utils/crucible/utils/network.js";

const altairForkEpoch = 2;
const bellatrixForkEpoch = 4;
const runTillEpoch = 6;
const syncWaitEpoch = 2;

const {estimatedTimeoutMs, forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  runTillEpoch: runTillEpoch + syncWaitEpoch,
  initialNodes: 3,
});

const env = await Simulation.initWithDefaults(
  {
    id: "backup-eth-provider",
    logsDir: path.join(logFilesDir, "backup-eth-provider"),
    forkConfig,
  },
  [{id: "node-1", beacon: BeaconClient.Lodestar, execution: ExecutionClient.Geth, keysCount: 32, mining: true}]
);

env.tracker.register({
  ...nodeAssertion,
  match: ({slot}) => {
    return slot === 1 ? Match.Assert | Match.Capture | Match.Remove : Match.None;
  },
});

// Create node2 with additional engine url pointing to node1
const node2 = await env.createNodePair({
  id: "node-2",
  // As the Lodestar running on host and the geth running in docker container
  // we have to replace the IP with the local ip to connect to the geth
  beacon: {
    type: BeaconClient.Lodestar,
    options: {engineUrls: [replaceIpFromUrl(env.nodes[0].execution.engineRpcPublicUrl, "127.0.0.1")]},
  },
  execution: ExecutionClient.Geth,
  keysCount: 32,
});

// Create node3 with additional engine url pointing to node1
const node3 = await env.createNodePair({
  id: "node-3",
  // As the Lodestar running on host and the geth running in docker container
  // we have to replace the IP with the local ip to connect to the geth
  beacon: {
    type: BeaconClient.Lodestar,
    options: {engineUrls: [replaceIpFromUrl(env.nodes[0].execution.engineRpcPublicUrl, "127.0.0.1")]},
  },
  execution: ExecutionClient.Geth,
  keysCount: 0,
});

env.nodes.push(node2);
env.nodes.push(node3);

await env.start({runTimeoutMs: estimatedTimeoutMs});
await connectAllNodes(env.nodes);

await waitForSlot("Waiting for two epochs to pass", {env, slot: env.clock.getLastSlotOfEpoch(1)});

// Stop node2, node3 EL, so the only way they produce blocks is via node1 EL
await node2.execution.job.stop();
await node3.execution.job.stop();

// node2 and node3 will successfully reach TTD if they can communicate to an EL on node1
await waitForSlot("Wait half additional epoch to bellatrix fork epoch", {
  slot: env.clock.getLastSlotOfEpoch(bellatrixForkEpoch) + activePreset.SLOTS_PER_EPOCH / 2,
  env,
});

await node2.beacon.job.stop();
await node3.beacon.job.stop();

await env.stop();
