import {PeerSyncMeta} from "../../../network/peers/peersData.js";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {PeerIdStr} from "../../../util/peerId.js";
import {shuffle} from "../../../util/shuffle.js";
import {sortBy} from "../../../util/sortBy.js";
import {Batch, BatchStatus} from "../batch.js";
import {ChainTarget} from "./chainTarget.js";

export type PeerSyncInfo = PeerSyncMeta & {
  target: ChainTarget;
};

/**
 * Balance and organize peers to perform requests with a SyncChain
 * Shuffles peers only once on instantiation
 */
export class ChainPeersBalancer {
  private peers: PeerSyncInfo[];
  private activeRequestsByPeer = new Map<PeerIdStr, number>();
  private readonly custodyConfig: CustodyConfig;

  // TODO: @matthewkeil check if this needs to be updated for custody groups
  constructor(peers: PeerSyncInfo[], batches: Batch[], custodyConfig: CustodyConfig) {
    this.peers = shuffle(peers);
    this.custodyConfig = custodyConfig;

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
      this.peers.filter(({earliestAvailableSlot, custodyGroups, target}) => {
        if (!batch.isFulu()) {
          return true;
        }

        // TODO(fulu): this is a bug and is prioritizing peers that do not announce
        //     an earliestAvailableSlot. Need to refactor this logic
        const earliestSlot = earliestAvailableSlot ?? 0;
        const peerColumns = custodyGroups;

        if (earliestSlot > batch.request.startSlot) {
          return false;
        }

        if (target.slot < batch.request.startSlot) {
          return false;
        }

        const pendingDataColumns = partialDownload
          ? partialDownload.pendingDataColumns
          : this.custodyConfig.sampledColumns;

        const columns = peerColumns.reduce((acc, elem) => {
          if (pendingDataColumns.includes(elem)) {
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
   * Return peers with 0 or no active requests that has a higher target slot than this batch and has columns we need.
   */
  idlePeerForBatch(batch: Batch): PeerSyncInfo | undefined {
    const eligiblePeers: {peerInfo: PeerSyncInfo; columns: number}[] = [];
    for (const peerInfo of this.peers) {
      const {peerId, custodyGroups, target, earliestAvailableSlot} = peerInfo;
      const activeRequests = this.activeRequestsByPeer.get(peerId);
      if (activeRequests != null && activeRequests > 0) {
        continue;
      }

      // TODO(fulu): this is a bug and is prioritizing peers that do not announce
      //     an earliestAvailableSlot. Need to refactor this logic
      const earliestSlot = earliestAvailableSlot ?? 0;
      if (earliestSlot > batch.request.startSlot) {
        continue;
      }

      if (target.slot < batch.request.startSlot) {
        continue;
      }

      if (!batch.isFulu()) {
        eligiblePeers.push({peerInfo, columns: 0});
        continue;
      }

      // fulu specific logic
      const peerColumns = custodyGroups;
      const columns = peerColumns.reduce((acc, elem) => {
        if (this.custodyConfig.sampledColumns.includes(elem)) {
          acc.push(elem);
        }
        return acc;
      }, [] as number[]);

      if (columns.length > 0) {
        eligiblePeers.push({peerInfo, columns: columns.length});
      }
    }

    // pick idle peer that has the most columns we need, for pre-fulu they are always 0
    const mostColumnsPeer = eligiblePeers.sort((a, b) => b.columns - a.columns)[0];
    if (mostColumnsPeer != null) {
      // we will use this peer for batch in SyncChain right after this call
      this.activeRequestsByPeer.set(mostColumnsPeer.peerInfo.peerId, 1);
      return mostColumnsPeer.peerInfo;
    }

    return undefined;
  }
}
