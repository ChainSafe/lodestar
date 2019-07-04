import {NodejsNode} from "../../../../network/libp2p/nodejs";
import {createPeerId, initializePeerInfo} from "../../../../network/libp2p/util";

export async function createNode(multiaddr: string): Promise<NodejsNode> {
  const peerId = await createPeerId();
  const peerInfo = await initializePeerInfo(peerId, [multiaddr]);
  return new NodejsNode({peerInfo});
}
