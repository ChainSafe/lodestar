/* eslint-disable @typescript-eslint/naming-convention */
import path from "node:path";
import {sleep, toHex, toHexString} from "@lodestar/utils";
import {ApiError, routes} from "@lodestar/api";
import {AssertionMatch, BeaconClient, ExecutionClient, ValidatorClient} from "../utils/simulation/interfaces.js";
import {SimulationEnvironment} from "../utils/simulation/SimulationEnvironment.js";
import {defineSimTestConfig, logFilesDir} from "../utils/simulation/utils/index.js";
import {
  connectAllNodes,
  connectNewCLNode,
  connectNewELNode,
  connectNewNode,
  waitForHead,
  waitForNodeSync,
  waitForSlot,
} from "../utils/simulation/utils/network.js";
import {nodeAssertion} from "../utils/simulation/assertions/nodeAssertion.js";
import {mergeAssertion} from "../utils/simulation/assertions/mergeAssertion.js";
import {createForkAssertion} from "../utils/simulation/assertions/forkAssertion.js";
import {createAccountBalanceAssertion} from "../utils/simulation/assertions/accountBalanceAssertion.js";
import {createExecutionHeadAssertion} from "../utils/simulation/assertions/executionHeadAssertion.js";

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
  initialNodes: 5,
});

const env = await SimulationEnvironment.initWithDefaults(
  {
    id: "multi-fork",
    logsDir: path.join(logFilesDir, "multi-fork"),
    forkConfig,
  },
  [
    // put 1 lodestar node on produceBlockV3, and 2nd on produceBlindedBlock and 3rd on produceBlockV2
    // specifying the useProduceBlockV3 options despite whatever default is set
    {
      id: "node-1",
      beacon: BeaconClient.Lodestar,
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          // this will cause race in beacon but since builder is not attached will
          // return with engine full block and publish via publishBlockV2
          clientOptions: {
            useProduceBlockV3: true,
            "builder.selection": "maxprofit",
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
          // this will make the beacon respond with blinded version of the local block as no
          // builder is attached to beacon, and publish via publishBlindedBlockV2
          clientOptions: {
            useProduceBlockV3: true,
            "builder.selection": "maxprofit",
            blindedLocal: true,
          },
        },
      },
      execution: ExecutionClient.Nethermind,
      keysCount: 32,
      remote: true,
    },
    {
      id: "node-3",
      beacon: BeaconClient.Lodestar,
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          // this builder selection will make it use produceBlockV2 and respond with full block
          clientOptions: {
            useProduceBlockV3: false,
            "builder.selection": "executiononly",
          },
        },
      },
      execution: ExecutionClient.Nethermind,
      keysCount: 32,
    },
    {
      id: "node-4",
      beacon: BeaconClient.Lodestar,
      validator: {
        type: ValidatorClient.Lodestar,
        options: {
          // this builder selection will make it use produceBlindedBlockV2 and respond with blinded version
          // of local block and subsequent publishing via publishBlindedBlock
          clientOptions: {
            useProduceBlockV3: false,
            "builder.selection": "maxprofit",
          },
        },
      },
      execution: ExecutionClient.Nethermind,
      keysCount: 32,
    },
    {id: "node-5", beacon: BeaconClient.Lighthouse, execution: ExecutionClient.Geth, keysCount: 32},
  ]
);

env.tracker.register({
  ...nodeAssertion,
  match: ({slot}) => {
    return slot === 1 ? AssertionMatch.Assert | AssertionMatch.Capture | AssertionMatch.Remove : AssertionMatch.None;
  },
});

env.tracker.register({
  ...mergeAssertion,
  match: ({slot}) => {
    // Check at the end of bellatrix fork, merge should happen by then
    return slot === env.clock.getLastSlotOfEpoch(bellatrixForkEpoch)
      ? AssertionMatch.Assert | AssertionMatch.Remove
      : AssertionMatch.None;
  },
});

env.tracker.register(
  createAccountBalanceAssertion({
    address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sendTransactionsAtSlot: [
      env.clock.getFirstSlotOfEpoch(altairForkEpoch) + 4,
      env.clock.getFirstSlotOfEpoch(bellatrixForkEpoch) + 4,
    ],
    validateTotalBalanceAt: [env.clock.getFirstSlotOfEpoch(bellatrixForkEpoch + 1) + 4],
    targetNode: env.nodes[0],
  })
);

env.tracker.register(
  createExecutionHeadAssertion({
    // Second last slot of second bellatrix epoch
    checkForSlot: [env.clock.getLastSlotOfEpoch(bellatrixForkEpoch + 1) - 1],
  })
);

await env.start({runTimeoutMs: estimatedTimeoutMs});
await connectAllNodes(env.nodes);

let lastForkEpoch = 0;
// Go through every fork and check which one is active and register assertion for it
// This will make sure this test would identify if we add new fork or activate one of the existing ones
for (const fork of env.forkConfig.forksAscendingEpochOrder) {
  if (!Number.isInteger(fork.epoch)) continue;
  lastForkEpoch = fork.epoch;
  env.tracker.register(createForkAssertion(fork.name, fork.epoch));
}

await waitForSlot(env.clock.getLastSlotOfEpoch(lastForkEpoch + 1), env.nodes, {
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

// TODO: A workaround for this issue for sim tests only
// 1. Start the execution node and let it connect to network
// 2. Wait for few seconds
// 3. And later start the beacon node and connect to network
// 4. With this delay the execution node would be synced before the beacon node starts
// https://github.com/ChainSafe/lodestar/issues/6435
// Revert to following code once the issue is fixed
//    await rangeSync.execution.job.start();
//    await rangeSync.beacon.job.start();
//    await connectNewNode(rangeSync, env.nodes);
await rangeSync.execution.job.start();
await connectNewELNode(
  rangeSync.execution,
  env.nodes.map((node) => node.execution)
);
await sleep(4000);
await rangeSync.beacon.job.start();
await connectNewCLNode(
  rangeSync.beacon,
  env.nodes.map((node) => node.beacon)
);

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

// Unknown block sync
// ========================================================
const headForUnknownBlockSync = await env.nodes[0].beacon.api.beacon.getBlockV2("head");
ApiError.assert(headForUnknownBlockSync);
const unknownBlockSync = await env.createNodePair({
  id: "unknown-block-sync-node",
  beacon: {
    type: BeaconClient.Lodestar,
    options: {
      clientOptions: {
        "network.allowPublishToZeroPeers": true,
        "sync.disableRangeSync": true,
        /*
        Initiation of the 'unknownBlockSync' node occurs when other nodes are several epochs ahead.
        The effectiveness of the 'unknown block sync' is contingent on the gap being at most 'slotImportTolerance * 2'.
        The default 'slotImportTolerance' value is one epoch; thus, if the gap exceeds 2 epochs,
        the 'unknown block sync' won't function properly. Moreover, the 'unknownBlockSync' requires some startup time,
        contributing to the overall gap. For stability in our CI, we've opted to set a higher limit on this constraint.
        */
        "sync.slotImportTolerance": headForUnknownBlockSync.response.data.message.slot,
      },
    },
  },
  execution: ExecutionClient.Geth,
  keysCount: 0,
});
await unknownBlockSync.execution.job.start();
await unknownBlockSync.beacon.job.start();
await connectNewNode(unknownBlockSync, env.nodes);

// Wait for EL node to start and sync
await sleep(5000);

try {
  ApiError.assert(
    await unknownBlockSync.beacon.api.beacon.publishBlockV2(headForUnknownBlockSync.response.data, {
      broadcastValidation: routes.beacon.BroadcastValidation.none,
    })
  );

  env.tracker.record({
    message: "Publishing unknown block should fail",
    slot: env.clock.currentSlot,
    assertionId: "unknownBlockParent",
  });
} catch (error) {
  if (!(error as Error).message.includes("BLOCK_ERROR_PARENT_UNKNOWN")) {
    env.tracker.record({
      message: `Publishing unknown block should return "BLOCK_ERROR_PARENT_UNKNOWN" got "${(error as Error).message}"`,
      slot: env.clock.currentSlot,
      assertionId: "unknownBlockParent",
    });
  }
}
await waitForHead(env, unknownBlockSync, {
  head: toHexString(
    env.forkConfig
      .getForkTypes(headForUnknownBlockSync.response.data.message.slot)
      .BeaconBlock.hashTreeRoot(headForUnknownBlockSync.response.data.message)
  ),
  slot: headForUnknownBlockSync.response.data.message.slot,
});

await unknownBlockSync.beacon.job.stop();
await unknownBlockSync.execution.job.stop();

await env.stop();
