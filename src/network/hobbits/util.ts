/**
 * @module network/hobbits
 */

import PeerInfo from "peer-info";
import {Multiaddr} from "multiaddr";
import {RequestId} from "./constants";

export function peerInfoToAddress(peerInfo: PeerInfo): Multiaddr {
  let addrs = peerInfo.multiaddrs.toArray();
  if(addrs.length == 0){
    throw Error("Invalid PeerInfo instance");
  }
  return addrs[0];
}

function randomNibble(): string {
  return Math.floor(Math.random() * 16).toString(16);
}

export function randomRequestId(): RequestId {
  return parseInt(Array.from({length: 16}, () => randomNibble()).join(''));
}
