/* eslint-disable no-console */
import {ApiError} from "@lodestar/api";
import {Slot} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {CLClient, CLNode, ELClient, ELNode, NodePair} from "../interfaces.js";
import {SimulationEnvironment} from "../SimulationEnvironment.js";
import {SimulationTrackerEvent} from "../SimulationTracker.js";

export async function connectAllNodes(nodes: NodePair[]): Promise<void> {
  for (const node of nodes) {
    await connectNewNode(node, nodes);
  }
}

export async function connectNewNode(newNode: NodePair, nodes: NodePair[]): Promise<void> {
  await connectNewELNode(
    newNode.el,
    nodes.map((node) => node.el)
  );
  await connectNewCLNode(
    newNode.cl,
    nodes.map((node) => node.cl)
  );
}

export async function connectNewCLNode(newNode: CLNode, nodes: CLNode[]): Promise<void> {
  const res = await newNode.api.node.getNetworkIdentity();
  ApiError.assert(res);
  const clIdentity = res.response.data;
  if (!clIdentity.peerId) return;

  for (const node of nodes) {
    if (node === newNode) continue;

    if (node.client === CLClient.Lodestar) {
      const res = await (node as CLNode<CLClient.Lodestar>).api.lodestar.connectPeer(
        clIdentity.peerId,
        // As the lodestar is always running on host
        // convert the address to local host to connect the container node
        clIdentity.p2pAddresses.map((str) => str.replace(/(\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/)/, "/127.0.0.1/"))
      );
      ApiError.assert(res);
    }
  }
}

export async function connectNewELNode(newNode: ELNode, nodes: ELNode[]): Promise<void> {
  const elIdentity = newNode.provider === null ? null : await newNode.provider.admin.nodeInfo();
  if (elIdentity && !elIdentity.enode) return;

  for (const node of nodes) {
    if (node === newNode) continue;

    // Nethermind had a bug in admin_addPeer RPC call
    // https://github.com/NethermindEth/nethermind/issues/4876
    if (node.provider !== null && node.client !== ELClient.Nethermind && elIdentity) {
      await node.provider.admin.addPeer(elIdentity.enode);
    }
  }
}

export async function waitForNodeSync(
  env: SimulationEnvironment,
  node: NodePair,
  options?: {head: string; slot: Slot}
): Promise<void> {
  if (options) {
    await Promise.all([waitForNodeSyncStatus(env, node), waitForHead(env, node, options)]);
    return;
  }

  return waitForNodeSyncStatus(env, node);
}

export async function waitForNodeSyncStatus(env: SimulationEnvironment, node: NodePair): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await node.cl.api.node.getSyncingStatus();
    ApiError.assert(result);
    if (!result.response.data.isSyncing) {
      break;
    } else {
      await sleep(1000, env.options.controller.signal);
    }
  }
}

export async function waitForHead(
  env: SimulationEnvironment,
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
  slot: Slot,
  nodes: NodePair[],
  {silent, env}: {silent?: boolean; env: SimulationEnvironment}
): Promise<void> {
  if (!silent) {
    console.log(`\nWaiting for slot on "${nodes.map((n) => n.cl.id).join(",")}"`, {
      target: slot,
      current: env.clock.currentSlot,
    });
  }

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
              reject(new Error(`${node.cl.id} had passed target slot ${slot}. Current slot ${event.slot}`));
            }
          };
          env.tracker.on(node, SimulationTrackerEvent.Slot, cb);
        })
    )
  );
}
