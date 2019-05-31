import {NodejsNode} from "../../../../src/network/libp2p/nodejs";
import {createPeerId, initializePeerInfo} from "../../../../src/network/libp2p/util";

export async function createNode(multiaddr): Promise<NodejsNode> {
  const peerId = await createPeerId();
  const peerInfo = await initializePeerInfo(peerId, [multiaddr]);
  return new NodejsNode({peerInfo});
}
