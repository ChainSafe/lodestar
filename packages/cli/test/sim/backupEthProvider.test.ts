import path from "node:path";
import {nodeAssertion} from "../utils/crucible/assertions/nodeAssertion.js";
import {BeaconClient, ExecutionClient, Match} from "../utils/crucible/interfaces.js";
import {Simulation} from "../utils/crucible/simulation.js";
import {defineSimTestConfig, logFilesDir, replaceIpFromUrl} from "../utils/crucible/utils/index.js";
import {connectAllNodes, connectNewNode, waitForSlot} from "../utils/crucible/utils/network.js";

const altairForkEpoch = 0;
const bellatrixForkEpoch = 0;
const capellaForkEpoch = 0;
const denebForkEpoch = 0;
const electraForkEpoch = 0;
const runTillEpoch = 4;

const {estimatedTimeoutMs, forkConfig} = defineSimTestConfig({
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  CAPELLA_FORK_EPOCH: capellaForkEpoch,
  DENEB_FORK_EPOCH: denebForkEpoch,
  ELECTRA_FORK_EPOCH: electraForkEpoch,
  runTillEpoch: runTillEpoch,
  additionalSlotsForTTD: 0,
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
// Must be created before env.start() since it has keysCount > 0 (needs to be included in genesis state)
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

env.nodes.push(node2);

// Start node-1 and node-2 together (both included in genesis state)
await env.start({runTimeoutMs: estimatedTimeoutMs});
await connectAllNodes(env.nodes);

// Get multiaddrs for directPeers configuration
const directPeers = env.nodes.map((n) => n.beacon.multiaddr).filter((m): m is string => m != null);

// Create node3 after start with directPeers for stable peer connectivity.
// node3 has keysCount: 0 so it can be created after genesis state initialization.
// directPeers ensures GossipSub maintains persistent mesh connections to all other nodes,
// preventing the connectedPeerCount assertion failures from peer connection degradation.
const node3 = await env.createNodePair({
  id: "node-3",
  // As the Lodestar running on host and the geth running in docker container
  // we have to replace the IP with the local ip to connect to the geth
  beacon: {
    type: BeaconClient.Lodestar,
    options: {
      engineUrls: [replaceIpFromUrl(env.nodes[0].execution.engineRpcPublicUrl, "127.0.0.1")],
      clientOptions: {directPeers},
    },
  },
  execution: ExecutionClient.Geth,
  keysCount: 0,
});

await node3.execution.job.start();
await node3.beacon.job.start();
env.nodes.push(node3);
env.tracker.track(node3);
await connectNewNode(node3, env.nodes);

await waitForSlot("Waiting for two epochs to pass", {env, slot: env.clock.getLastSlotOfEpoch(1)});

// Stop node2, node3 EL, so the only way they produce blocks is via node1 EL
await node2.execution.job.stop();
await node3.execution.job.stop();

// node2 and node3 will successfully reach TTD if they can communicate to an EL on node1
await waitForSlot("Wait half additional epoch to bellatrix fork epoch", {
  slot: env.clock.getLastSlotOfEpoch(2),
  env,
});

await node2.beacon.job.stop();
await node3.beacon.job.stop();

await env.stop();
