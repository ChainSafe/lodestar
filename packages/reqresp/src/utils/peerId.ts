import {PeerId} from "@libp2p/interface";

export function prettyPrintPeerId(peerId: PeerId): string {
  const id = peerId.toString();
  return `${id.substr(0, 2)}...${id.substr(id.length - 6, id.length)}`;
}
