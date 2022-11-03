import {NodePair} from "../interfaces.js";

export async function connectAllNodes(nodes: NodePair[]): Promise<void> {
  for (const node1 of nodes) {
    for (const node2 of nodes) {
      if (node1 === node2) continue;

      const elIdentity = await node1.el.provider.admin.nodeInfo();
      if (!elIdentity.enode) continue;
      await node1.el.provider.admin.addPeer(elIdentity.enode);

      const clIdentity = (await node1.cl.api.node.getNetworkIdentity()).data;
      if (!clIdentity.peerId) continue;
      await node2.cl.api.lodestar.connectPeer(clIdentity.peerId, clIdentity.p2pAddresses);
    }
  }
}

export async function connectNewNode(newNode: NodePair, nodes: NodePair[]): Promise<void> {
  const clIdentity = (await newNode.cl.api.node.getNetworkIdentity()).data;
  if (!clIdentity.peerId) return;

  const elIdentity = await newNode.el.provider.admin.nodeInfo();
  if (!elIdentity.enode) return;

  for (const node of nodes) {
    await node.cl.api.lodestar.connectPeer(clIdentity.peerId, clIdentity.p2pAddresses);
    await node.el.provider.admin.addPeer(elIdentity.enode);
  }
}
