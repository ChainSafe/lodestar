import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {PeerId} from "@libp2p/interface-peer-id";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {IBeaconConfig} from "@lodestar/config";
import {Epoch, phase0} from "@lodestar/types";
import {ILogger, toHex} from "@lodestar/utils";
import {IBeaconChain} from "../../chain/index.js";
import {INetwork} from "../../network/index.js";
import {IMetrics} from "../../metrics/index.js";
import {RangeSyncType, rangeSyncTypes, getRangeSyncTarget} from "../utils/remoteSyncType.js";
import {ImportBlockOpts} from "../../chain/blocks/index.js";
import {updateChains} from "./utils/index.js";
import {ChainTarget, SyncChainFns, SyncChain, SyncChainDebugState} from "./chain.js";

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
  metrics: IMetrics | null;
  config: IBeaconConfig;
  logger: ILogger;
};

export type RangeSyncOpts = {
  disableProcessAsChainSegment?: boolean;
};

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
  private readonly metrics: IMetrics | null;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  /** There is a single chain per type, 1 finalized sync, 1 head sync */
  private readonly chains = new Map<RangeSyncType, SyncChain>();

  private opts?: RangeSyncOpts;

  constructor(modules: RangeSyncModules, opts?: RangeSyncOpts) {
    super();
    const {chain, network, metrics, config, logger} = modules;
    this.chain = chain;
    this.network = network;
    this.metrics = metrics;
    this.config = config;
    this.logger = logger;
    this.opts = opts;

    if (metrics) {
      metrics.syncStatus.addCollect(() => this.scrapeMetrics(metrics));
    }
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
    const {syncType, startEpoch, target} = getRangeSyncTarget(localStatus, peerStatus, this.chain.forkChoice);
    this.logger.debug("Sync peer joined", {
      peer: peerId.toString(),
      syncType,
      startEpoch,
      targetSlot: target.slot,
      targetRoot: toHex(target.root),
    });

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
  private processChainSegment: SyncChainFns["processChainSegment"] = async (blocks, syncType) => {
    // Not trusted, verify signatures
    const flags: ImportBlockOpts = {
      // Only skip importing attestations for finalized sync. For head sync attestation are valuable.
      // Importing attestations also triggers a head update, see https://github.com/ChainSafe/lodestar/issues/3804
      // TODO: Review if this is okay, can we prevent some attacks by importing attestations?
      skipImportingAttestations: syncType === RangeSyncType.Finalized,
      // Ignores ALREADY_KNOWN or GENESIS_BLOCK errors, and continues with the next block in chain segment
      ignoreIfKnown: true,
      // Ignore WOULD_REVERT_FINALIZED_SLOT error, continue with the next block in chain segment
      ignoreIfFinalized: true,
      // We won't attest to this block so it's okay to ignore a SYNCING message from execution layer
      fromRangeSync: true,
      // when this runs, syncing is the most important thing and gossip is not likely to run
      // so we can utilize worker threads to verify signatures
      blsVerifyOnMainThread: false,
    };

    if (this.opts?.disableProcessAsChainSegment) {
      // Should only be used for debugging or testing
      for (const block of blocks) await this.chain.processBlock(block, flags);
    } else {
      await this.chain.processChainSegment(blocks, flags);
    }
  };

  /** Convenience method for `SyncChain` */
  private downloadBeaconBlocksByRange: SyncChainFns["downloadBeaconBlocksByRange"] = async (peerId, request) => {
    return await this.network.reqResp.beaconBlocksByRange(peerId, request);
  };

  /** Convenience method for `SyncChain` */
  private reportPeer: SyncChainFns["reportPeer"] = (peer, action, actionName) => {
    this.network.reportPeer(peer, action, actionName);
  };

  /** Convenience method for `SyncChain` */
  private onSyncChainEnd: SyncChainFns["onEnd"] = (err, target) => {
    this.update(this.chain.forkChoice.getFinalizedCheckpoint().epoch);
    this.emit(RangeSyncEvent.completedChain);

    if (err === null && target !== null) {
      this.metrics?.syncRange.syncChainHighestTargetSlotCompleted.set(target.slot);
    }
  };

  private addPeerOrCreateChain(startEpoch: Epoch, target: ChainTarget, peer: PeerId, syncType: RangeSyncType): void {
    let syncChain = this.chains.get(syncType);
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
        {config: this.config, logger: this.logger}
      );
      this.chains.set(syncType, syncChain);

      this.metrics?.syncRange.syncChainsEvents.inc({syncType: syncChain.syncType, event: "add"});
      this.logger.debug("SyncChain added", {
        syncType,
        firstEpoch: syncChain.firstBatchEpoch,
        targetSlot: syncChain.target.slot,
        targetRoot: toHex(syncChain.target.root),
      });
    }

    syncChain.addPeer(peer, target);
  }

  private update(localFinalizedEpoch: Epoch): void {
    const localFinalizedSlot = computeStartSlotAtEpoch(localFinalizedEpoch);

    // Remove chains that are out-dated, peer-empty, completed or failed
    for (const [id, syncChain] of this.chains.entries()) {
      // Checks if a Finalized or Head chain should be removed
      if (
        // Sync chain has completed syncing or encountered an error
        syncChain.isRemovable ||
        // Sync chain has no more peers to download from
        syncChain.peers === 0 ||
        // Outdated: our chain has progressed beyond this sync chain
        syncChain.target.slot < localFinalizedSlot ||
        this.chain.forkChoice.hasBlock(syncChain.target.root)
      ) {
        syncChain.remove();
        this.chains.delete(id);

        this.metrics?.syncRange.syncChainsEvents.inc({syncType: syncChain.syncType, event: "remove"});
        this.logger.debug("SyncChain removed", {
          id: syncChain.logId,
          localFinalizedSlot,
          lastValidatedSlot: syncChain.lastValidatedSlot,
          firstEpoch: syncChain.firstBatchEpoch,
          targetSlot: syncChain.target.slot,
          targetRoot: toHex(syncChain.target.root),
          validatedEpochs: syncChain.validatedEpochs,
        });

        // Re-status peers from successful chain. Potentially trigger a Head sync
        this.network.reStatusPeers(syncChain.getPeers());
      }
    }

    const {toStop, toStart} = updateChains(Array.from(this.chains.values()));

    for (const syncChain of toStop) {
      syncChain.stopSyncing();
      if (syncChain.isSyncing) {
        this.metrics?.syncRange.syncChainsEvents.inc({syncType: syncChain.syncType, event: "stop"});
      }
    }

    for (const syncChain of toStart) {
      syncChain.startSyncing(localFinalizedEpoch);
      if (!syncChain.isSyncing) {
        this.metrics?.syncRange.syncChainsEvents.inc({syncType: syncChain.syncType, event: "start"});
      }
    }
  }

  private scrapeMetrics(metrics: IMetrics): void {
    metrics.syncRange.syncChainsPeers.reset();
    const syncChainsByType: Record<RangeSyncType, number> = {
      [RangeSyncType.Finalized]: 0,
      [RangeSyncType.Head]: 0,
    };

    for (const chain of this.chains.values()) {
      metrics.syncRange.syncChainsPeers.observe({syncType: chain.syncType}, chain.peers);
      syncChainsByType[chain.syncType]++;
    }

    for (const syncType of rangeSyncTypes) {
      metrics.syncRange.syncChains.set({syncType}, syncChainsByType[syncType]);
    }
  }
}
