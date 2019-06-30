import PeerInfo from "peer-info";
import NodeAddress = Multiaddr.NodeAddress;

export function peerInfoToAddress(peerInfo: PeerInfo): NodeAddress {
  let addrs = peerInfo.multiaddrs.toArray();
  if(addrs.length == 0){
    throw Error("Invalid PeerInfo instance");
  }
  let addr = addrs[0];
  return addr.nodeAddress();

}