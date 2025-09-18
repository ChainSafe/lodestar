import {isForkPostFulu} from "@lodestar/params";
import {PeerSyncMeta} from "../../../network/peers/peersData.js";
import {CustodyConfig} from "../../../util/dataColumns.js";
import {PeerIdStr} from "../../../util/peerId.js";
import {shuffle} from "../../../util/shuffle.js";
import {sortBy} from "../../../util/sortBy.js";
import {MAX_CONCURRENT_REQUESTS} from "../../constants.js";
import {RangeSyncType} from "../../utils/remoteSyncType.js";
import {Batch, BatchStatus} from "../batch.js";
import {ChainTarget} from "./chainTarget.js";

export type PeerSyncInfo = PeerSyncMeta & {
  target: ChainTarget;
};

type PeerInfoColumn = {syncInfo: PeerSyncInfo; columns: number; hasEarliestAvailableSlots: boolean};

/**
 * Balance and organize peers to perform requests with a SyncChain
 * Shuffles peers only once on instantiation
 */
export class ChainPeersBalancer {
  private peers: PeerSyncInfo[];
  private activeRequestsByPeer = new Map<PeerIdStr, number>();
  private readonly custodyConfig: CustodyConfig;
  private readonly syncType: RangeSyncType;
  private readonly maxConcurrentRequests: number;

  /**
   * No need to specify `maxConcurrentRequests` for production code
   * It is used for testing purposes to limit the number of concurrent requests
   */
  constructor(
    peers: PeerSyncInfo[],
    batches: Batch[],
    custodyConfig: CustodyConfig,
    syncType: RangeSyncType,
    maxConcurrentRequests = MAX_CONCURRENT_REQUESTS
  ) {
    this.peers = shuffle(peers);
    this.custodyConfig = custodyConfig;
    this.syncType = syncType;
    this.maxConcurrentRequests = maxConcurrentRequests;

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
    const {columnsRequest} = batch.requests;
    // TODO(fulu): This is fulu specific and hinders our peer selection PreFulu
    const pendingDataColumns = columnsRequest?.columns ?? this.custodyConfig.sampledColumns;
    const eligiblePeers = this.filterPeers(batch, pendingDataColumns, false);

    const failedPeers = new Set(batch.getFailedPeers());
    const sortedBestPeers = sortBy(
      eligiblePeers,
      ({syncInfo}) => (failedPeers.has(syncInfo.peerId) ? 1 : 0), // prefer peers without failed requests
      ({syncInfo}) => this.activeRequestsByPeer.get(syncInfo.peerId) ?? 0, // prefer peers with least active req
      ({columns}) => -1 * columns // prefer peers with the most columns
    );

    if (sortedBestPeers.length > 0) {
      const bestPeer = sortedBestPeers[0];
      // we will use this peer for batch in SyncChain right after this call
      this.activeRequestsByPeer.set(
        bestPeer.syncInfo.peerId,
        (this.activeRequestsByPeer.get(bestPeer.syncInfo.peerId) ?? 0) + 1
      );
      return bestPeer.syncInfo;
    }

    return undefined;
  }

  /**
   * Return peers with 0 or no active requests that has a higher target slot than this batch and has columns we need.
   */
  idlePeerForBatch(batch: Batch): PeerSyncInfo | undefined {
    if (batch.state.status !== BatchStatus.AwaitingDownload) {
      return;
    }
    const eligiblePeers = this.filterPeers(batch, this.custodyConfig.sampledColumns, true);

    // pick idle peer that has (for pre-fulu they are the same)
    // - earliestAvailableSlot defined
    // - the most columns we need
    const sortedBestPeers = sortBy(
      eligiblePeers,
      ({columns}) => -1 * columns // prefer peers with most columns we need
    );
    const bestPeer = sortedBestPeers[0];
    if (bestPeer != null) {
      // we will use this peer for batch in SyncChain right after this call
      this.activeRequestsByPeer.set(bestPeer.syncInfo.peerId, 1);
      return bestPeer.syncInfo;
    }

    return undefined;
  }

  private filterPeers(batch: Batch, requestColumns: number[], noActiveRequest: boolean): PeerInfoColumn[] {
    const eligiblePeers: PeerInfoColumn[] = [];

    if (batch.state.status !== BatchStatus.AwaitingDownload) {
      return eligiblePeers;
    }

    for (const peer of this.peers) {
      const {earliestAvailableSlot, target, peerId} = peer;

      const activeRequest = this.activeRequestsByPeer.get(peerId) ?? 0;
      if (noActiveRequest && activeRequest > 0) {
        // consumer wants to find peer with no active request, but this peer has active request
        continue;
      }

      if (activeRequest >= this.maxConcurrentRequests) {
        // consumer wants to find peer with no more than MAX_CONCURRENT_REQUESTS active requests
        continue;
      }

      if (target.slot < batch.startSlot) {
        continue;
      }

      if (isForkPostFulu(batch.forkName) && this.syncType === RangeSyncType.Head) {
        // for head sync, target slot is head slot and each peer may have a different head slot
        // we don't want to retry a batch with a peer that's not as up-to-date as the previous peer
        // see https://github.com/ChainSafe/lodestar/issues/8193
        const blocks = batch.state?.blocks;
        const lastBlock = blocks?.at(-1);
        const lastBlockSlot = lastBlock?.slot;
        if (lastBlockSlot && lastBlockSlot > target.slot) {
          continue;
        }
      }

      if (!isForkPostFulu(batch.forkName)) {
        // pre-fulu logic, we don't care columns and earliestAvailableSlot
        eligiblePeers.push({syncInfo: peer, columns: 0, hasEarliestAvailableSlots: false});
        continue;
      }

      // we don't accept peers without earliestAvailableSlot because it may return 0 blocks and we get stuck
      // see https://github.com/ChainSafe/lodestar/issues/8147
      if (earliestAvailableSlot == null) {
        continue;
      }

      if (earliestAvailableSlot > batch.startSlot) {
        continue;
      }

      const columns = peer.custodyColumns.reduce((acc, elem) => {
        if (requestColumns.includes(elem)) {
          acc.push(elem);
        }
        return acc;
      }, [] as number[]);

      if (columns.length > 0) {
        eligiblePeers.push({
          syncInfo: peer,
          columns: columns.length,
          hasEarliestAvailableSlots: earliestAvailableSlot != null,
        });
      }
    }

    return eligiblePeers;
  }
}
