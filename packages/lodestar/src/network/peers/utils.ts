import {IPeerMetadataStore} from "./interface";
import PeerId from "peer-id";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";

export function getPeersWithSubnet(peers: PeerId[], peerMetadata: IPeerMetadataStore, subnetStr: string): PeerId[] {
  if (!new RegExp("^\\d+$").test(subnetStr)) {
    throw new Error(`Invalid subnet ${subnetStr}`);
  }
  const subnet = parseInt(subnetStr);
  if (subnet < 0 || subnet >= ATTESTATION_SUBNET_COUNT) {
    throw new Error(`Invalid subnet ${subnetStr}`);
  }
  return peers.filter((peer) => {
    const meta = peerMetadata.getMetadata(peer);
    //remove if no metadata or not in subnet
    return !(!meta || !meta.attnets[subnet]);
  });
}
