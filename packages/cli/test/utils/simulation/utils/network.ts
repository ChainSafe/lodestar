import {routes} from "@lodestar/api";
import {Slot} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {CLNode, ELClient, NodePair} from "../interfaces.js";
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

export async function waitForNodeSync(node: NodePair, signal: AbortSignal): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await node.cl.api.node.getSyncingStatus();
    if (result.data.isSyncing) {
      await sleep(1000, signal);
    } else {
      break;
    }
  }
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

export async function waitForEvent(
  event: routes.events.EventType,
  node: CLNode | "any",
  {env}: {env: SimulationEnvironment}
): Promise<routes.events.BeaconEvent> {
  console.log(`Waiting for event "${event}" on "${node === "any" ? node : node.id}"`);

  return new Promise((resolve) => {
    const handler = (beaconEvent: routes.events.BeaconEvent, eventNode: CLNode): void => {
      if (node == "any") {
        env.emitter.removeListener(event, handler);
        resolve(beaconEvent);
      }

      if (node !== "any" && eventNode === node) {
        env.emitter.removeListener(event, handler);
        resolve(beaconEvent);
      }
    };

    env.tracker.emitter.addListener(event, handler);
  });
}
