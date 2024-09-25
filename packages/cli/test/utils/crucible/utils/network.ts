/* eslint-disable no-console */
import {SignedBeaconBlock, Slot} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {BeaconClient, BeaconNode, ExecutionClient, ExecutionNode, NodePair} from "../interfaces.js";
import {Simulation} from "../simulation.js";
import {SimulationTrackerEvent} from "../simulationTracker.js";

export async function connectAllNodes(nodes: NodePair[]): Promise<void> {
  for (const node of nodes) {
    await connectNewNode(node, nodes);
  }
}

export async function connectNewNode(newNode: NodePair, nodes: NodePair[]): Promise<void> {
  await connectNewELNode(
    newNode.execution,
    nodes.map((node) => node.execution)
  );
  await connectNewCLNode(
    newNode.beacon,
    nodes.map((node) => node.beacon)
  );
}

export async function connectNewCLNode(newNode: BeaconNode, nodes: BeaconNode[]): Promise<void> {
  const clIdentity = (await newNode.api.node.getNetworkIdentity()).value();
  if (!clIdentity.peerId) return;

  for (const node of nodes) {
    if (node === newNode) continue;

    if (node.client === BeaconClient.Lodestar) {
      (
        await (node as BeaconNode<BeaconClient.Lodestar>).api.lodestar.connectPeer({
          peerId: clIdentity.peerId,
          // As the lodestar is always running on host
          // convert the address to local host to connect the container node
          multiaddrs: clIdentity.p2pAddresses.map((str) =>
            str.replace(/(\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/)/, "/127.0.0.1/")
          ),
        })
      ).assertOk();
    }
  }
}

export async function connectNewELNode(newNode: ExecutionNode, nodes: ExecutionNode[]): Promise<void> {
  const elIdentity = newNode.provider === null ? null : await newNode.provider?.admin.nodeInfo();
  if (elIdentity && !elIdentity.enode) return;

  for (const node of nodes) {
    if (node === newNode) continue;

    // Nethermind had a bug in admin_addPeer RPC call
    // https://github.com/NethermindEth/nethermind/issues/4876
    if (node.provider !== null && node.client !== ExecutionClient.Nethermind && elIdentity) {
      // `web3.admin` here refers to the Web3 plugin `Web3AdminPlugin`
      await node.provider.admin.addPeer(elIdentity.enode);
    }
  }
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
    } else {
      await sleep(1000, env.options.controller.signal);
    }
  }
}

export async function waitForHead(
  env: Simulation,
  node: NodePair,
  options: {slot: Slot; head: string; silent?: boolean}
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!options.silent) {
      console.log(`\nWaiting for head=${options.head} slot=${options.slot} on node=${node.id}.`);
    }
    let firstHeadEventSlot: number;

    const cb = (event: {block: string; slot: Slot}): void => {
      if (!firstHeadEventSlot) {
        firstHeadEventSlot = event.slot;
      }

      // The syncing happens quickly and we already crossed the head slot
      if (firstHeadEventSlot >= options.slot) {
        env.tracker.off(node, SimulationTrackerEvent.Head, cb);
        resolve();
        return;
      }

      if (event.block === options.head) {
        env.tracker.off(node, SimulationTrackerEvent.Head, cb);
        resolve();
        return;
      }
    };

    env.tracker.on(node, SimulationTrackerEvent.Head, cb);
  });
}

export async function waitForSlot(
  message: string,
  {env, slot, nodes}: {env: Simulation; slot: Slot; nodes?: NodePair[]}
): Promise<void> {
  nodes = nodes ?? env.nodes;

  console.log(`\n${message}`, {
    target: slot,
    current: env.clock.currentSlot,
    nodes: nodes.map((n) => n.beacon.id).join(","),
  });

  await Promise.all(
    nodes.map(
      (node) =>
        new Promise<void>((resolve, reject) => {
          const cb = (event: {slot: Slot}): void => {
            if (slot === event.slot) {
              resolve();
              env.tracker.off(node, SimulationTrackerEvent.Slot, cb);
              return;
            }

            if (event.slot >= slot) {
              reject(new Error(`${node.beacon.id} had passed target slot ${slot}. Current slot ${event.slot}`));
            }
          };
          env.tracker.on(node, SimulationTrackerEvent.Slot, cb);
        })
    )
  );
}

export async function fetchBlock(
  node: NodePair,
  {tries, delay, slot, signal}: {slot: number; tries: number; delay: number; signal?: AbortSignal}
): Promise<SignedBeaconBlock | undefined> {
  for (let i = 0; i < tries; i++) {
    const res = await node.beacon.api.beacon.getBlockV2({blockId: slot});
    if (!res.ok) {
      await sleep(delay, signal);
      continue;
    }

    return res.value();
  }

  return;
}
