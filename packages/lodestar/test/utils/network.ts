import {ENR, Discv5Discovery} from "@chainsafe/discv5";
import Bootstrap from "libp2p-bootstrap";
import MDNS from "libp2p-mdns";
import PeerId from "peer-id";

import {NodejsNode} from "../../src/network/nodejs";
import {createPeerId, initializePeerInfo} from "../../src/network";
import defaults from "../../src/network/options";

export async function createNode(
  multiaddr: string,
  inPeerId?: PeerId,
  peerDiscovery?: (typeof Bootstrap | typeof MDNS | typeof Discv5Discovery)[]): Promise<NodejsNode> {
  const peerId = inPeerId || await createPeerId();
  const enr = ENR.createFromPeerId(peerId);
  const randomPort = Math.round(Math.random() * 40000) + 1000;
  const bindAddr = `/ip4/127.0.0.1/udp/${randomPort}`;
  const peerInfo = await initializePeerInfo(peerId, [multiaddr]);
  return new NodejsNode({peerInfo, discv5: {...defaults.discv5, enr, bindAddr}, peerDiscovery});
}