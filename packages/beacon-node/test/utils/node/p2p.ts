import {Connection} from "libp2p";
import PeerId from "peer-id";
import {Multiaddr} from "multiaddr";
import {PeerStatus, PeerDirection} from "../../../src/network/index.js";

export function libp2pConnection(peer: PeerId, status: PeerStatus, direction: PeerDirection): Connection {
  return {
    remoteAddr: new Multiaddr(),
    stat: {
      status,
      direction,
    },
    remotePeer: peer,
  } as Connection;
}
