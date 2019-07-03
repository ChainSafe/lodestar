import PeerInfo from "peer-info";
import {Multiaddr} from "multiaddr";

export function peerInfoToAddress(peerInfo: PeerInfo): Multiaddr {
  let addrs = peerInfo.multiaddrs.toArray();
  if(addrs.length == 0){
    throw Error("Invalid PeerInfo instance");
  }
  return addrs[0];
}