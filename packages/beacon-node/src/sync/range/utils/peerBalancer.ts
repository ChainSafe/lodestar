import {PeerIdStr} from "../../../util/peerId.js";
import {shuffle} from "../../../util/shuffle.js";
import {sortBy} from "../../../util/sortBy.js";
import {Batch, BatchStatus} from "../batch.js";

export type PeerWithMeta = {
  peerId: PeerIdStr;
  custodyColumns?: number[];
  clientAgent?: string;
};

export type PeerWithOverlap = PeerWithMeta & {
  neededColumns?: number[];
};
/**
 * Balance and organize peers to perform requests with a SyncChain
 * Shuffles peers only once on instantiation
 */
export class ChainPeersBalancer {
  private peers: PeerWithMeta[];
  private activeRequestsByPeer = new Map<PeerIdStr, number>();

  // TODO: @matthewkeil check if this needs to be updated for custody groups
  constructor(peers: PeerWithMeta[], batches: Batch[]) {
    this.peers = shuffle(peers);

    // Compute activeRequestsByPeer from all batches internal states
    for (const batch of batches) {
      if (batch.state.status === BatchStatus.Downloading) {
        this.activeRequestsByPeer.set(batch.state.peer, (this.activeRequestsByPeer.get(batch.state.peer) ?? 0) + 1);
      }
    }
  }

  /**
   * Return the most suitable peer to retry
   * Sort peers by (1) most column overlap (post-fulu) (2) no failed request (3) less active requests, then pick first
   */
  bestPeerToRetryBatch(batch: Batch): PeerWithOverlap {
    let unsorted = this.peers;
    // if we have a column download look for the peer with the best
    // overlap of custody to pull from
    if (batch.neededColumns) {
      const overlappingPeers: PeerWithMeta[] = [];
      for (const peer of this.peers) {
        const overlappingColumns = [];
        for (const peerColumn of peer.custodyColumns ?? []) {
          if (batch.neededColumns.includes(peerColumn)) {
            overlappingColumns.push(peerColumn);
          }
        }
        if (overlappingColumns.length) {
          overlappingPeers.push({
            peerId: peer.peerId,
            custodyColumns: overlappingColumns,
            clientAgent: peer.clientAgent,
          });
        }
      }
      // TODO: should we throw and error or maybe log something here if there is no column overlap with any peer?
      if (overlappingPeers.length) {
        unsorted = overlappingPeers;
      }
    }

    const failedPeers = new Set(batch.getFailedPeers());
    const sortedBestPeers = sortBy(
      unsorted.sort((a, b) => b.custodyColumns?.length - a.custodyColumns?.length),
      // TODO: Should the overlap sort go before or after these conditions
      (peer) => (failedPeers.has(peer) ? 1 : 0), // Sort by no failed first = 0
      (peer) => this.activeRequestsByPeer.get(peer) ?? 0 // Sort by least active req
    );

    const bestPeer = sortedBestPeers[0];
    const neededColumns = batch.neededColumns?.filter((index) => !bestPeer.custodyColumns?.includes(index));
    return {
      ...bestPeer,
      neededColumns,
    };
  }

  /**
   * Return peers with 0 or no active requests
   */
  idlePeers(): PeerIdStr[] {
    return this.peers.filter((peer) => {
      const activeRequests = this.activeRequestsByPeer.get(peer);
      return activeRequests === undefined || activeRequests === 0;
    });
  }
}
