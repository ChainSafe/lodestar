import {PeerSyncMeta} from "../../../network/peers/peersData.js";
import {PeerIdStr} from "../../../util/peerId.js";
import {shuffle} from "../../../util/shuffle.js";
import {sortBy} from "../../../util/sortBy.js";
import {Batch, BatchStatus} from "../batch.js";

/**
 * Balance and organize peers to perform requests with a SyncChain
 * Shuffles peers only once on instantiation
 */
export class ChainPeersBalancer {
  private peers: PeerSyncMeta[];
  private activeRequestsByPeer = new Map<PeerIdStr, number>();

  // TODO: @matthewkeil check if this needs to be updated for custody groups
  constructor(peers: PeerSyncMeta[], batches: Batch[]) {
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
  bestPeerToRetryBatch(batch: Batch): PeerSyncMeta | undefined {
    if (batch.state.status !== BatchStatus.AwaitingDownload) {
      return;
    }
    const {partialDownload} = batch.state;

    const failedPeers = new Set(batch.getFailedPeers());
    const sortedBestPeers = sortBy(
      this.peers.filter(({earliestAvailableSlot, custodyGroups}) => {
        // TODO(fulu): this is a bug and is prioritizing peers that do not announce
        //     an earliestAvailableSlot. Need to refactor this logic
        const earliestSlot = earliestAvailableSlot ?? 0;
        const peerColumns = custodyGroups ?? [];

        if (earliestSlot > batch.request.startSlot) {
          return false;
        }

        if (partialDownload === null) {
          return true;
        }

        const columns = peerColumns.reduce((acc, elem) => {
          if (partialDownload.pendingDataColumns.includes(elem)) {
            acc.push(elem);
          }
          return acc;
        }, [] as number[]);

        return columns.length > 0;
      }),
      ({peerId}) => (failedPeers.has(peerId) ? 1 : 0), // Sort by no failed first = 0
      ({peerId}) => this.activeRequestsByPeer.get(peerId) ?? 0 // Sort by least active req
    );

    return sortedBestPeers[0];
  }

  /**
   * Return peers with 0 or no active requests
   */
  idlePeers(): PeerSyncMeta[] {
    return this.peers.filter(({peerId}) => {
      const activeRequests = this.activeRequestsByPeer.get(peerId);
      return activeRequests === undefined || activeRequests === 0;
    });
  }
}
