import Multiaddr from "multiaddr";
import {ENR} from "@chainsafe/discv5";

import {NodejsNode} from "../../../src/network/nodejs";
import {createPeerId, initializePeerInfo} from "../../../src/network";
import defaults from "../../../src/network/options";

export async function createNode(multiaddr: string): Promise<NodejsNode> {
  const peerId = await createPeerId();
  const enr = ENR.createFromPeerId(peerId);
  const randomPort = Math.round(Math.random() * 40000) + 1000;
  const bindAddr = Multiaddr(`/ip4/127.0.0.1/udp/${randomPort}`);
  const peerInfo = await initializePeerInfo(peerId, [multiaddr]);
  return new NodejsNode({peerInfo, discv5: {...defaults.discv5, enr, bindAddr}});
}
