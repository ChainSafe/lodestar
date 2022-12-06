/* eslint-disable no-console */
import {Slot} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {ELClient, NodePair} from "../interfaces.js";
import {SimulationEnvironment} from "../SimulationEnvironment.js";
import {SimulationTrackerEvent} from "../SimulationTracker.js";

export async function connectAllNodes(nodes: NodePair[]): Promise<void> {
  for (const node of nodes) {
    await connectNewNode(node, nodes);
  }
}

export async function connectNewNode(newNode: NodePair, nodes: NodePair[]): Promise<void> {
  const clIdentity = (await newNode.cl.api.node.getNetworkIdentity()).data;
  if (!clIdentity.peerId) return;

  const elIdentity = newNode.el.provider === null ? null : await newNode.el.provider.admin.nodeInfo();
  if (elIdentity && !elIdentity.enode) return;

  for (const node of nodes) {
    if (node === newNode) continue;

    // Nethermind had a bug in admin_addPeer RPC call
    // https://github.com/NethermindEth/nethermind/issues/4876
    if (node.el.provider !== null && node.el.client !== ELClient.Nethermind && elIdentity) {
      await node.el.provider.admin.addPeer(elIdentity.enode);
    }

    await node.cl.api.lodestar.connectPeer(clIdentity.peerId, clIdentity.p2pAddresses);
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
    if (!result.data.isSyncing) {
      break;
    } else {
      await sleep(1000, env.options.controller.signal);
    }
  }
}

export async function waitForHead(
  env: SimulationEnvironment,
  node: NodePair,
  options: {slot: Slot; head: string}
): Promise<void> {
  return new Promise<void>((resolve) => {
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

  for (const node of nodes) {
    const head = await node.cl.api.beacon.getBlockHeader("head");
    const headSlot = head.data.header.message.slot;
    if (headSlot > slot) {
      throw Error(`waitForSlot error, node ${node.id} head.slot ${headSlot} > target slot ${slot}`);
    }
  }

  await Promise.all(
    nodes.map(
      (node) =>
        new Promise<void>((resolve) => {
          const cb = (event: {slot: Slot}): void => {
            // TODO FOR NAZAR: slots may be skipped, so we can't just assert event.slot == slot
            if (event.slot >= slot) {
              resolve();
              env.tracker.off(node, SimulationTrackerEvent.Slot, cb);
            }
          };
          env.tracker.on(node, SimulationTrackerEvent.Slot, cb);
        })
    )
  );
}
