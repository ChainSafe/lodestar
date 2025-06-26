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

type PeerInfoColumn = {syncInfo: PeerSyncInfo; columns: number};

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
    const pendingDataColumns = partialDownload?.pendingDataColumns ?? this.custodyConfig.sampledColumns;
    const eligiblePeers = this.filterPeers(batch, pendingDataColumns, false);

    const failedPeers = new Set(batch.getFailedPeers());
    const sortedBestPeers = sortBy(
      eligiblePeers,
      ({syncInfo}) => (failedPeers.has(syncInfo.peerId) ? 1 : 0), // Sort by no failed first = 0
      ({syncInfo}) => this.activeRequestsByPeer.get(syncInfo.peerId) ?? 0, // Sort by least active req
      ({columns}) => -1 * columns // Sort by most columns we need
    );

    return sortedBestPeers[0].syncInfo;
  }

  /**
   * Return peers with 0 or no active requests that has a higher target slot than this batch and has columns we need.
   */
  idlePeerForBatch(batch: Batch): PeerSyncInfo | undefined {
    const eligiblePeers = this.filterPeers(batch, this.custodyConfig.sampledColumns, true);

    // pick idle peer that has the most columns we need, for pre-fulu they are always 0
    const mostColumnsPeer = eligiblePeers.sort((a, b) => b.columns - a.columns)[0];
    if (mostColumnsPeer != null) {
      // we will use this peer for batch in SyncChain right after this call
      this.activeRequestsByPeer.set(mostColumnsPeer.syncInfo.peerId, 1);
      return mostColumnsPeer.syncInfo;
    }

    return undefined;
  }

  private filterPeers(batch: Batch, requestColumns: number[], checkActiveRequest: boolean): PeerInfoColumn[] {
    const eligiblePeers: PeerInfoColumn[] = [];

    for (const peer of this.peers) {
      const {earliestAvailableSlot, custodyGroups, target, peerId} = peer;

      const activeRequest = this.activeRequestsByPeer.get(peerId) ?? 0;
      if (checkActiveRequest && activeRequest > 0) {
        continue;
      }

      if (target.slot < batch.request.startSlot) {
        continue;
      }

      if (!batch.isFulu()) {
        // pre-fulu logic
        eligiblePeers.push({syncInfo: peer, columns: 0});
        continue;
      }

      // TODO(fulu): this is a bug and is prioritizing peers that do not announce
      //     an earliestAvailableSlot. Need to refactor this logic
      const earliestSlot = earliestAvailableSlot ?? 0;
      const peerColumns = custodyGroups;

      if (earliestSlot > batch.request.startSlot) {
        continue;
      }

      const columns = peerColumns.reduce((acc, elem) => {
        if (requestColumns.includes(elem)) {
          acc.push(elem);
        }
        return acc;
      }, [] as number[]);

      if (columns.length > 0) {
        eligiblePeers.push({syncInfo: peer, columns: columns.length});
      }
    }

    return eligiblePeers;
  }
}
