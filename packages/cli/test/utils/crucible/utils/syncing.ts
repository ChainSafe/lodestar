import {routes} from "@lodestar/api";
import {SignedBeaconBlock, Slot} from "@lodestar/types";
import {sleep, toHex} from "@lodestar/utils";
import {ForkBlobs} from "@lodestar/params";
import type {Simulation} from "../simulation.js";
import {BeaconClient, ExecutionClient, NodePair} from "../interfaces.js";
import {connectNewCLNode, connectNewELNode, connectNewNode, waitForHead, waitForSlot} from "./network.js";

export async function assertRangeSync(env: Simulation): Promise<void> {
  const currentHead = (await env.nodes[0].beacon.api.beacon.getBlockHeader({blockId: "head"})).value();

  const rangeSync = await env.createNodePair({
    id: "range-sync-node",
    beacon: BeaconClient.Lodestar,
    execution: ExecutionClient.Geth,
    keysCount: 0,
  });

  /*
   * Range sync rate limit exhaust when execution node is syncing
   * https://github.com/ChainSafe/lodestar/issues/6435
   *
   * A workaround for this issue for sim tests only
   * 1. Start the execution node and let it connect to network
   * 2. Wait for few seconds
   * 3. And later start the beacon node and connect to network
   * 4. With this delay the execution node would be synced before the beacon node starts
   *
   * Revert to following code once the issue is fixed
   *  await rangeSync.execution.job.start();
   *  await rangeSync.beacon.job.start();
   *  await connectNewNode(rangeSync, env.nodes);
   */

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

  await waitForNodeSync(env, rangeSync, {
    head: toHex(currentHead.root),
    slot: currentHead.header.message.slot,
  });

  await rangeSync.beacon.job.stop();
  await rangeSync.execution.job.stop();
}

export async function assertCheckpointSync(env: Simulation): Promise<void> {
  if (env.clock.currentEpoch <= 4) {
    // First checkpoint finalized is at least 4 epochs
    await waitForSlot("Waiting for 4th epoch to pass, to get first finalized checkpoint", {
      env,
      slot: env.clock.getFirstSlotOfEpoch(4),
      nodes: [env.nodes[0]],
    });
  }

  const finalizedCheckpoint = (
    await env.nodes[0].beacon.api.beacon.getStateFinalityCheckpoints({stateId: "head"})
  ).value();

  const checkpointSync = await env.createNodePair({
    id: "checkpoint-sync-node",
    beacon: {
      type: BeaconClient.Lodestar,
      options: {
        clientOptions: {
          wssCheckpoint: `${toHex(finalizedCheckpoint.finalized.root)}:${finalizedCheckpoint.finalized.epoch}`,
        },
      },
    },
    execution: ExecutionClient.Geth,
    keysCount: 0,
  });

  await checkpointSync.execution.job.start();
  await checkpointSync.beacon.job.start();
  await connectNewNode(checkpointSync, env.nodes);

  await waitForNodeSync(env, checkpointSync, {
    head: toHex(finalizedCheckpoint.finalized.root),
    slot: env.clock.getLastSlotOfEpoch(finalizedCheckpoint.finalized.epoch),
  });

  await checkpointSync.beacon.job.stop();
  await checkpointSync.execution.job.stop();
}

export async function assertUnknownBlockSync(env: Simulation): Promise<void> {
  const currentHead = (await env.nodes[0].beacon.api.beacon.getBlockV2({blockId: "head"})).value();
  const currentSidecars = (
    await env.nodes[0].beacon.api.beacon.getBlobSidecars({blockId: currentHead.message.slot})
  ).value();

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
          "sync.slotImportTolerance": currentHead.message.slot,
        },
      },
    },
    execution: ExecutionClient.Geth,
    keysCount: 0,
  });
  await unknownBlockSync.execution.job.start();
  await unknownBlockSync.beacon.job.start();
  await connectNewNode(unknownBlockSync, env.nodes);

  // Wait for EL node to start and sync before publishing an unknown block
  await sleep(5000);
  try {
    (
      await unknownBlockSync.beacon.api.beacon.publishBlockV2({
        signedBlockOrContents: {
          signedBlock: currentHead as SignedBeaconBlock<ForkBlobs>,
          blobs: currentSidecars.map((b) => b.blob),
          kzgProofs: currentSidecars.map((b) => b.kzgProof),
        },
        broadcastValidation: routes.beacon.BroadcastValidation.none,
      })
    ).assertOk();

    env.tracker.record({
      message: "Publishing unknown block should fail",
      slot: env.clock.currentSlot,
      assertionId: "unknownBlockParent",
    });
  } catch (error) {
    if (!(error as Error).message.includes("BLOCK_ERROR_PARENT_UNKNOWN")) {
      env.tracker.record({
        message: `Publishing unknown block should return "BLOCK_ERROR_PARENT_UNKNOWN" got "${
          (error as Error).message
        }"`,
        slot: env.clock.currentSlot,
        assertionId: "unknownBlockParent",
      });
    }
  }

  await waitForHead(env, unknownBlockSync, {
    head: toHex(env.forkConfig.getForkTypes(currentHead.message.slot).BeaconBlock.hashTreeRoot(currentHead.message)),
    slot: currentHead.message.slot,
  });

  await unknownBlockSync.beacon.job.stop();
  await unknownBlockSync.execution.job.stop();
}

export async function waitForNodeSync(
  env: Simulation,
  node: NodePair,
  options?: {head: string; slot: Slot}
): Promise<void> {
  if (options) {
    await Promise.all([waitForNodeSyncStatus(env, node), waitForHead(env, node, options)]);
    return;
  }

  return waitForNodeSyncStatus(env, node);
}

export async function waitForNodeSyncStatus(env: Simulation, node: NodePair): Promise<void> {
  while (true) {
    const result = (await node.beacon.api.node.getSyncingStatus()).value();
    if (!result.isSyncing) {
      break;
    }
    await sleep(1000, env.options.controller.signal);
  }
}
