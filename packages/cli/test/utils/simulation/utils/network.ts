import {ELClient, NodePair} from "../interfaces.js";

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
