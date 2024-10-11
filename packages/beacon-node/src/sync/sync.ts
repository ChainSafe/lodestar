import {Logger} from "@lodestar/utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {INetwork, NetworkEvent, NetworkEventData} from "../network/index.js";
import {isOptimisticBlock} from "../util/forkChoice.js";
import {Metrics} from "../metrics/index.js";
import {IBeaconChain} from "../chain/index.js";
import {ClockEvent} from "../util/clock.js";
import {GENESIS_SLOT} from "../constants/constants.js";
import {ExecutionEngineState} from "../execution/index.js";
import {IBeaconSync, SyncModules, SyncingStatus} from "./interface.js";
import {RangeSync, RangeSyncStatus, RangeSyncEvent} from "./range/range.js";
import {getPeerSyncType, PeerSyncType, peerSyncTypes} from "./utils/remoteSyncType.js";
import {MIN_EPOCH_TO_START_GOSSIP} from "./constants.js";
import {SyncState, SyncChainDebugState, syncStateMetric} from "./interface.js";
import {SyncOptions} from "./options.js";
import {UnknownBlockSync} from "./unknownBlock.js";

export class BeaconSync implements IBeaconSync {
  private readonly logger: Logger;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;
  private readonly metrics: Metrics | null;
  private readonly opts: SyncOptions;

  private readonly rangeSync: RangeSync;
  private readonly unknownBlockSync: UnknownBlockSync;

  /** For metrics only */
  private readonly peerSyncType = new Map<string, PeerSyncType>();
  private readonly slotImportTolerance: Slot;

  constructor(opts: SyncOptions, modules: SyncModules) {
    const {config, chain, metrics, network, logger} = modules;
    this.opts = opts;
    this.network = network;
    this.chain = chain;
    this.metrics = metrics;
    this.logger = logger;
    this.rangeSync = new RangeSync(modules, opts);
    this.unknownBlockSync = new UnknownBlockSync(config, network, chain, logger, metrics, opts);
    this.slotImportTolerance = opts.slotImportTolerance ?? SLOTS_PER_EPOCH;

    // Subscribe to RangeSync completing a SyncChain and recompute sync state
    if (!opts.disableRangeSync) {
      // prod code
      this.logger.debug("RangeSync enabled.");
      this.rangeSync.on(RangeSyncEvent.completedChain, this.updateSyncState);
      this.network.events.on(NetworkEvent.peerConnected, this.addPeer);
      this.network.events.on(NetworkEvent.peerDisconnected, this.removePeer);
      this.chain.clock.on(ClockEvent.epoch, this.onClockEpoch);
    } else {
      // test code, this is needed for Unknown block sync sim test
      this.unknownBlockSync.subscribeToNetwork();
      this.logger.debug("RangeSync disabled.");

      // In case node is started with `rangeSync` disabled and `unknownBlockSync` is enabled.
      // If the epoch boundary happens right away the `onClockEpoch` will check for the `syncDiff` and if
      // it's more than 2 epoch will disable the disabling the `unknownBlockSync` as well.
      // This will result into node hanging on the head slot and not syncing any blocks.
      // This was the scenario in the test case `Unknown block sync` in `packages/cli/test/sim/multi_fork.test.ts`
      // So we are adding a particular delay to ensure that the `unknownBlockSync` is enabled.
      const syncStartSlot = this.chain.clock.currentSlot;
      // Having one epoch time for the node to connect to peers and start a syncing process
      const epochCheckForSyncSlot = syncStartSlot + SLOTS_PER_EPOCH;
      const initiateEpochCheckForSync = (): void => {
        if (this.chain.clock.currentSlot > epochCheckForSyncSlot) {
          this.logger.info("Initiating epoch check for sync progress");
          this.chain.clock.off(ClockEvent.slot, initiateEpochCheckForSync);
          this.chain.clock.on(ClockEvent.epoch, this.onClockEpoch);
        }
      };
      this.chain.clock.on(ClockEvent.slot, initiateEpochCheckForSync);
    }

    if (metrics) {
      metrics.syncStatus.addCollect(() => this.scrapeMetrics(metrics));
    }
  }

  close(): void {
    this.network.events.off(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.off(NetworkEvent.peerDisconnected, this.removePeer);
    this.chain.clock.off(ClockEvent.epoch, this.onClockEpoch);
    this.rangeSync.close();
    this.unknownBlockSync.close();
  }

  getSyncStatus(): SyncingStatus {
    const currentSlot = this.chain.clock.currentSlot;
    const elOffline = this.chain.executionEngine.state === ExecutionEngineState.OFFLINE;

    // If we are pre/at genesis, signal ready
    if (currentSlot <= GENESIS_SLOT) {
      return {
        headSlot: 0,
        syncDistance: 0,
        isSyncing: false,
        isOptimistic: false,
        elOffline,
      };
    } else {
      const head = this.chain.forkChoice.getHead();

      switch (this.state) {
        case SyncState.SyncingFinalized:
        case SyncState.SyncingHead:
        case SyncState.Stalled:
          return {
            headSlot: head.slot,
            syncDistance: currentSlot - head.slot,
            isSyncing: true,
            isOptimistic: isOptimisticBlock(head),
            elOffline,
          };
        case SyncState.Synced:
          return {
            headSlot: head.slot,
            syncDistance: 0,
            isSyncing: false,
            isOptimistic: isOptimisticBlock(head),
            elOffline,
          };
        default:
          throw new Error("Node is stopped, cannot get sync status");
      }
    }
  }

  isSyncing(): boolean {
    const state = this.state; // Don't run the getter twice
    return state === SyncState.SyncingFinalized || state === SyncState.SyncingHead;
  }

  isSynced(): boolean {
    return this.state === SyncState.Synced;
  }

  get state(): SyncState {
    const currentSlot = this.chain.clock.currentSlot;
    const headSlot = this.chain.forkChoice.getHead().slot;

    if (
      // Consider node synced IF
      // Before genesis OR
      (currentSlot < 0 ||
        // head is behind clock but close enough with some tolerance
        (headSlot <= currentSlot && headSlot >= currentSlot - this.slotImportTolerance)) &&
      // Ensure there at least one connected peer to not claim synced if has no peers
      // Allow to bypass this conditions for local networks with a single node
      (this.opts.isSingleNode || this.network.getConnectedPeerCount() > 0)
      // TODO: Consider enabling this condition (used in Lighthouse)
      // && headSlot > 0
    ) {
      return SyncState.Synced;
    }

    const rangeSyncState = this.rangeSync.state;
    switch (rangeSyncState.status) {
      case RangeSyncStatus.Finalized:
        return SyncState.SyncingFinalized;
      case RangeSyncStatus.Head:
        return SyncState.SyncingHead;
      case RangeSyncStatus.Idle:
        return SyncState.Stalled;
      default:
        throw new Error("Unreachable code");
    }
  }

  /** Full debug state for lodestar API */
  getSyncChainsDebugState(): SyncChainDebugState[] {
    return this.rangeSync.getSyncChainsDebugState();
  }

  /**
   * A peer has connected which has blocks that are unknown to us.
   *
   * This function handles the logic associated with the connection of a new peer. If the peer
   * is sufficiently ahead of our current head, a range-sync (batch) sync is started and
   * batches of blocks are queued to download from the peer. Batched blocks begin at our latest
   * finalized head.
   *
   * If the peer is within the `SLOT_IMPORT_TOLERANCE`, then it's head is sufficiently close to
   * ours that we consider it fully sync'd with respect to our current chain.
   */
  private addPeer = (data: NetworkEventData[NetworkEvent.peerConnected]): void => {
    const localStatus = this.chain.getStatus();
    const syncType = getPeerSyncType(localStatus, data.status, this.chain.forkChoice, this.slotImportTolerance);

    // For metrics only
    this.peerSyncType.set(data.peer.toString(), syncType);

    if (syncType === PeerSyncType.Advanced) {
      this.rangeSync.addPeer(data.peer, localStatus, data.status);
    }

    this.updateSyncState();
  };

  /**
   * Must be called by libp2p when a peer is removed from the peer manager
   */
  private removePeer = (data: NetworkEventData[NetworkEvent.peerDisconnected]): void => {
    this.rangeSync.removePeer(data.peer);

    this.peerSyncType.delete(data.peer.toString());
  };

  /**
   * Run this function when the sync state can potentially change.
   */
  private updateSyncState = (): void => {
    const state = this.state; // Don't run the getter twice

    // We have become synced, subscribe to all the gossip core topics
    if (state === SyncState.Synced && this.chain.clock.currentEpoch >= MIN_EPOCH_TO_START_GOSSIP) {
      if (!this.network.isSubscribedToGossipCoreTopics()) {
        this.network
          .subscribeGossipCoreTopics()
          .then(() => {
            this.metrics?.syncSwitchGossipSubscriptions.inc({action: "subscribed"});
            this.logger.info("Subscribed gossip core topics");
          })
          .catch((e) => {
            this.logger.error("Error subscribing to gossip core topics", {}, e);
          });
      }

      // also start searching for unknown blocks
      if (!this.unknownBlockSync.isSubscribedToNetwork()) {
        this.unknownBlockSync.subscribeToNetwork();
        this.metrics?.syncUnknownBlock.switchNetworkSubscriptions.inc({action: "subscribed"});
      }
    }

    // If we stopped being synced and fallen significantly behind, stop gossip
    else if (state !== SyncState.Synced) {
      const syncDiff = this.chain.clock.currentSlot - this.chain.forkChoice.getHead().slot;
      if (syncDiff > this.slotImportTolerance * 2) {
        if (this.network.isSubscribedToGossipCoreTopics()) {
          this.logger.warn(`Node sync has fallen behind by ${syncDiff} slots`);
          this.network
            .unsubscribeGossipCoreTopics()
            .then(() => {
              this.metrics?.syncSwitchGossipSubscriptions.inc({action: "unsubscribed"});
              this.logger.info("Un-subscribed gossip core topics");
            })
            .catch((e) => {
              this.logger.error("Error unsubscribing to gossip core topics", {}, e);
            });
        }

        // also stop searching for unknown blocks
        if (this.unknownBlockSync.isSubscribedToNetwork()) {
          this.unknownBlockSync.unsubscribeFromNetwork();
          this.metrics?.syncUnknownBlock.switchNetworkSubscriptions.inc({action: "unsubscribed"});
        }
      }
    }
  };

  private onClockEpoch = (): void => {
    // If a node witness the genesis event consider starting gossip
    // Also, ensure that updateSyncState is run at least once per epoch.
    // If the chain gets stuck or very overloaded it could helps to resolve the situation
    // by realizing it's way behind and turning gossip off.
    this.updateSyncState();
  };

  private scrapeMetrics(metrics: Metrics): void {
    // Compute current sync state
    metrics.syncStatus.set(syncStateMetric[this.state]);

    // Count peers by syncType
    const peerCountByType: Record<PeerSyncType, number> = {
      [PeerSyncType.Advanced]: 0,
      [PeerSyncType.FullySynced]: 0,
      [PeerSyncType.Behind]: 0,
    };
    for (const syncType of this.peerSyncType.values()) {
      peerCountByType[syncType]++;
    }

    for (const syncType of peerSyncTypes) {
      metrics.syncPeersBySyncType.set({syncType}, peerCountByType[syncType]);
    }
  }
}
