import {Connection} from "@libp2p/interface-connection";
import {PeerId} from "@libp2p/interface-peer-id";
import {multiaddr} from "@multiformats/multiaddr";
import {PeerDirection, PeerStatus} from "@lodestar/beacon-node/network";


export function libp2pConnection(peer: PeerId, status: PeerStatus, direction: PeerDirection): Connection {
  return {
    remoteAddr: multiaddr(),
    stat: {
      status,
      direction,
    },
    remotePeer: peer,
  } as Connection;
}
