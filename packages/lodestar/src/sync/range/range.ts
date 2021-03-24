import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import PeerId from "peer-id";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, Slot, phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconChain} from "../../chain";
import {INetwork} from "../../network";
import {IBeaconMetrics} from "../../metrics";
import {RangeSyncType, getRangeSyncType} from "../utils";
import {updateChains, shouldRemoveChain} from "./utils";
import {ChainTarget, SyncChainFns, SyncChain, SyncChainOpts, SyncChainDebugState} from "./chain";

export enum RangeSyncEvent {
  completedChain = "RangeSync-completedChain",
}

type RangeSyncEvents = {
  [RangeSyncEvent.completedChain]: () => void;
};

type RangeSyncEmitter = StrictEventEmitter<EventEmitter, RangeSyncEvents>;

export enum RangeSyncStatus {
  /** A finalized chain is being synced */
  Finalized,
  /** There are no finalized chains and we are syncing one more head chains */
  Head,
  /** There are no head or finalized chains and no long range sync is in progress */
  Idle,
}

type RangeSyncState =
  | {status: RangeSyncStatus.Finalized; target: ChainTarget}
  | {status: RangeSyncStatus.Head; targets: ChainTarget[]}
  | {status: RangeSyncStatus.Idle};

export type RangeSyncModules = {
  chain: IBeaconChain;
  network: INetwork;
  metrics?: IBeaconMetrics;
  config: IBeaconConfig;
  logger: ILogger;
};

export type RangeSyncOpts = SyncChainOpts;

/**
 * RangeSync groups peers by their `status` into static target `SyncChain` instances
 * Peers on each chain will be queried for batches until reaching their target.
 *
 * Not all SyncChain-s will sync at once, and are grouped by sync type:
 * - Finalized Chain Sync
 * - Head Chain Sync
 *
 * ### Finalized Chain Sync
 *
 * At least one peer's status finalized checkpoint is greater than ours. Then we'll form
 * a chain starting from our finalized epoch and sync up to their finalized checkpoint.
 * - Only one finalized chain can sync at a time
 * - The finalized chain with the largest peer pool takes priority
 * - As peers' status progresses we will switch to a SyncChain with a better target
 *
 * ### Head Chain Sync
 *
 * If no Finalized Chain Sync is active, and the peer's STATUS head is beyond
 * `SLOT_IMPORT_TOLERANCE`, then we'll form a chain starting from our finalized epoch and sync
 * up to their head.
 * - More than one head chain can sync in parallel
 * - If there are many head chains the ones with more peers take priority
 */
export class RangeSync extends (EventEmitter as {new (): RangeSyncEmitter}) {
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly metrics?: IBeaconMetrics;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly chains = new Map<string, SyncChain>();

  private opts?: SyncChainOpts;

  constructor(modules: RangeSyncModules, opts?: SyncChainOpts) {
    super();
    this.chain = modules.chain;
    this.network = modules.network;
    this.metrics = modules.metrics;
    this.config = modules.config;
    this.logger = modules.logger;
    this.opts = opts;
  }

  /** Throw / return all AsyncGenerators inside every SyncChain instance */
  close(): void {
    for (const chain of this.chains.values()) {
      chain.remove();
    }
  }

  /**
   * A peer with a relevant STATUS message has been found, which also is advanced from us.
   * Add this peer to an existing chain or create a new one. The update the chains status.
   */
  addPeer(peerId: PeerId, localStatus: phase0.Status, peerStatus: phase0.Status): void {
    // Compute if we should do a Finalized or Head sync with this peer
    const syncType = getRangeSyncType(localStatus, peerStatus, this.chain);
    this.logger.debug("Sync peer joined", {peer: peerId.toB58String(), syncType});

    let startEpoch: Slot;
    let target: ChainTarget;
    switch (syncType) {
      case RangeSyncType.Finalized: {
        startEpoch = localStatus.finalizedEpoch;
        target = {
          slot: computeStartSlotAtEpoch(this.config, peerStatus.finalizedEpoch),
          root: peerStatus.finalizedRoot,
        };
        break;
      }

      case RangeSyncType.Head: {
        // The new peer has the same finalized (earlier filters should prevent a peer with an
        // earlier finalized chain from reaching here).
        startEpoch = Math.min(computeEpochAtSlot(this.config, localStatus.headSlot), peerStatus.finalizedEpoch);
        target = {
          slot: peerStatus.headSlot,
          root: peerStatus.headRoot,
        };
        break;
      }
    }

    // If the peer existed in any other chain, remove it.
    // re-status'd peers can exist in multiple finalized chains, only one sync at a time
    if (syncType === RangeSyncType.Head) {
      this.removePeer(peerId);
    }

    this.addPeerOrCreateChain(startEpoch, target, peerId, syncType);
    this.update(localStatus.finalizedEpoch);
  }

  /**
   * Remove this peer from all head and finalized chains. A chain may become peer-empty and be dropped
   */
  removePeer(peerId: PeerId): void {
    for (const syncChain of this.chains.values()) {
      syncChain.removePeer(peerId);
    }
  }

  /**
   * Compute the current RangeSync state, not cached
   */
  get state(): RangeSyncState {
    const syncingHeadTargets: ChainTarget[] = [];
    for (const chain of this.chains.values()) {
      if (chain.isSyncing) {
        if (chain.syncType === RangeSyncType.Finalized) {
          return {status: RangeSyncStatus.Finalized, target: chain.target};
        } else {
          syncingHeadTargets.push(chain.target);
        }
      }
    }

    if (syncingHeadTargets.length > 0) {
      return {status: RangeSyncStatus.Head, targets: syncingHeadTargets};
    } else {
      return {status: RangeSyncStatus.Idle};
    }
  }

  /** Full debug state for lodestar API */
  getSyncChainsDebugState(): SyncChainDebugState[] {
    return Array.from(this.chains.values())
      .map((syncChain) => syncChain.getDebugState())
      .reverse(); // Newest additions first
  }

  /** Convenience method for `SyncChain` */
  private processChainSegment: SyncChainFns["processChainSegment"] = async (blocks) => {
    const trusted = true; // TODO: Verify signatures
    await this.chain.processChainSegment(blocks, trusted);
  };

  /** Convenience method for `SyncChain` */
  private downloadBeaconBlocksByRange: SyncChainFns["downloadBeaconBlocksByRange"] = async (peerId, request) => {
    return await this.network.reqResp.beaconBlocksByRange(peerId, request);
  };

  /** Convenience method for `SyncChain` */
  private reportPeer: SyncChainFns["reportPeer"] = (peer, action, actionName) => {
    this.network.peerRpcScores.applyAction(peer, action, actionName);
  };

  /** Convenience method for `SyncChain` */
  private onSyncChainEnd: SyncChainFns["onEnd"] = () => {
    const localStatus = this.chain.getStatus();
    this.update(localStatus.finalizedEpoch);
    this.emit(RangeSyncEvent.completedChain);
  };

  private addPeerOrCreateChain(startEpoch: Epoch, target: ChainTarget, peer: PeerId, syncType: RangeSyncType): void {
    const id = `${syncType}-${target.slot}-${toHexString(target.root)}`;

    let syncChain = this.chains.get(id);
    if (!syncChain) {
      syncChain = new SyncChain(
        startEpoch,
        target,
        syncType,
        {
          processChainSegment: this.processChainSegment,
          downloadBeaconBlocksByRange: this.downloadBeaconBlocksByRange,
          reportPeer: this.reportPeer,
          onEnd: this.onSyncChainEnd,
        },
        {config: this.config, logger: this.logger},
        this.opts
      );
      this.chains.set(id, syncChain);
      this.logger.verbose("New syncChain", {id: syncChain.logId});
    }

    syncChain.addPeer(peer);
  }

  private update(localFinalizedEpoch: Epoch): void {
    const localFinalizedSlot = computeStartSlotAtEpoch(this.config, localFinalizedEpoch);

    // Remove chains that are out-dated, peer-empty, completed or failed
    for (const [id, syncChain] of this.chains.entries()) {
      if (shouldRemoveChain(syncChain, localFinalizedSlot, this.chain)) {
        syncChain.remove();
        this.chains.delete(id);
        this.logger.debug("Removed syncChain", {id: syncChain.logId});

        // Re-status peers from successful chain. Potentially trigger a Head sync
        this.network.reStatusPeers(syncChain.getPeers());
      }
    }

    const {toStop, toStart} = updateChains(Array.from(this.chains.values()));

    for (const syncChain of toStop) {
      syncChain.stopSyncing();
    }

    for (const syncChain of toStart) {
      syncChain.startSyncing(localFinalizedEpoch);
      if (!syncChain.isSyncing) this.metrics?.syncChainsStarted.inc({syncType: syncChain.syncType});
    }
  }
}
