/* eslint-disable no-console */
import {Slot} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {ELClient, NodePair} from "../interfaces.js";
import {SimulationEnvironment} from "../SimulationEnvironment.js";

export async function connectAllNodes(nodes: NodePair[]): Promise<void> {
  for (const node of nodes) {
    await connectNewNode(node, nodes);
  }
}

export async function connectNewNode(newNode: NodePair, nodes: NodePair[]): Promise<void> {
  const clIdentity = (await newNode.cl.api.node.getNetworkIdentity()).data;
  if (!clIdentity.peerId) return;

  const elIdentity = await newNode.el.provider.admin.nodeInfo();
  if (!elIdentity.enode) return;

  for (const node of nodes) {
    if (node === newNode) continue;

    // Nethermind had a bug in admin_addPeer RPC call
    // https://github.com/NethermindEth/nethermind/issues/4876
    if (node.el.client !== ELClient.Nethermind) {
      await node.el.provider.admin.addPeer(elIdentity.enode);
    }

    await node.cl.api.lodestar.connectPeer(clIdentity.peerId, clIdentity.p2pAddresses);
  }
}

export async function waitForNodeSync(env: SimulationEnvironment, node: NodePair, head?: string): Promise<void> {
  let headReached = true;

  if (head) {
    headReached = false;
    env.tracker.onHeadChange(node, ({block}) => {
      if (block === head) {
        headReached = true;
      }
    });
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await node.cl.api.node.getSyncingStatus();
    if (!result.data.isSyncing && headReached) {
      break;
    } else {
      await sleep(1000, env.options.controller.signal);
    }
  }
}

export async function waitForHead(env: SimulationEnvironment, node: NodePair, head: string): Promise<void> {
  return new Promise<void>((resolve) => {
    env.tracker.onHeadChange(node, ({block}) => {
      if (block === head) {
        resolve();
      }
    });
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
    (nodes ?? nodes).map(
      (node) =>
        new Promise((resolve) => {
          env.tracker.onSlot(slot, node, resolve);
        })
    )
  );
}
