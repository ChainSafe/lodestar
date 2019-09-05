import {NodejsNode} from "../../../src/network/nodejs";
import {createPeerId, initializePeerInfo} from "../../../src/network/util";

export async function createNode(multiaddr: string): Promise<NodejsNode> {
  const peerId = await createPeerId();
  const peerInfo = await initializePeerInfo(peerId, [multiaddr]);
  return new NodejsNode({peerInfo});
}
