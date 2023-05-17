import {PeerIdStr} from "../../../util/peerId.js";
import {shuffle} from "../../../util/shuffle.js";
import {sortBy} from "../../../util/sortBy.js";
import {Batch, BatchStatus} from "../batch.js";

/**
 * Balance and organize peers to perform requests with a SyncChain
 * Shuffles peers only once on instantiation
 */
export class ChainPeersBalancer {
  private peers: PeerIdStr[];
  private activeRequestsByPeer = new Map<PeerIdStr, number>();

  constructor(peers: PeerIdStr[], batches: Batch[]) {
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
   * Sort peers by (1) no failed request (2) less active requests, then pick first
   */
  bestPeerToRetryBatch(batch: Batch): PeerIdStr | undefined {
    const failedPeers = new Set(batch.getFailedPeers());
    const sortedBestPeers = sortBy(
      this.peers,
      (peer) => (failedPeers.has(peer) ? 1 : 0), // Sort by no failed first = 0
      (peer) => this.activeRequestsByPeer.get(peer) ?? 0 // Sort by least active req
    );
    return sortedBestPeers[0];
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
