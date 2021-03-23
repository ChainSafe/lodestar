import PeerId from "peer-id";
import {Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {INetwork} from "../../network";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ZERO_HASH} from "../../constants";
import {IPeerMetadataStore} from "../../network/peers";
import {getSyncPeers} from "./peers";

/**
 * Get best head from peers that support beacon_blocks_by_range.
 */
export function getBestHead(peers: PeerId[], peerMetaStore: IPeerMetadataStore): {slot: number; root: Root} {
  return peers
    .map((peerId) => {
      const status = peerMetaStore.status.get(peerId);
      return status ? {slot: status.headSlot, root: status.headRoot} : {slot: 0, root: ZERO_HASH};
    })
    .reduce(
      (head, peerStatus) => {
        return peerStatus.slot >= head.slot ? peerStatus : head;
      },
      {slot: 0, root: ZERO_HASH}
    );
}

/**
 * Get best peer that support beacon_blocks_by_range.
 */
export function getBestPeer(config: IBeaconConfig, peers: PeerId[], peerMetaStore: IPeerMetadataStore): PeerId {
  const {root} = getBestHead(peers, peerMetaStore);
  return peers.find((peerId) =>
    config.types.Root.equals(root, peerMetaStore.status.get(peerId)?.headRoot || ZERO_HASH)
  )!;
}

/**
 * Check if a peer is good to be a best peer.
 */
export function checkBestPeer(peer: PeerId, forkChoice: IForkChoice, network: INetwork): boolean {
  return getBestPeerCandidates(forkChoice, network).includes(peer);
}

/**
 * Return candidate for best peer.
 */
export function getBestPeerCandidates(forkChoice: IForkChoice, network: INetwork): PeerId[] {
  return getSyncPeers(
    network,
    (peer) => {
      const status = network.peerMetadata.status.get(peer);
      return !!status && status.headSlot > forkChoice.getHead().slot;
    },
    10
  );
}
