import {PeerId} from "@libp2p/interface-peer-id";
import {ILogger} from "@lodestar/utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot, phase0} from "@lodestar/types";
import {INetwork, NetworkEvent} from "@lodestar/beacon-node/network";
import {IMetrics} from "@lodestar/beacon-node/metrics";
import {IBeaconConfig} from "@lodestar/config";
import {IBeaconSync, ISyncModules, SyncChainDebugState, SyncingStatus, SyncState} from "@lodestar/beacon-node/sync";
import {IBeaconChain} from "@lodestar/beacon-node/chain";
import {ChainEvent} from "../chain/index.js";
import {MIN_EPOCH_TO_START_GOSSIP} from "./constants.js";
import {SyncOptions} from "./options.js";

export class LightNodeSync implements IBeaconSync {
  private readonly logger: ILogger;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;
  private readonly metrics: IMetrics | null;
  private readonly opts: SyncOptions;
  private readonly config: IBeaconConfig;


  /**
   * The number of slots ahead of us that is allowed before starting a RangeSync
   * If a peer is within this tolerance (forwards or backwards), it is treated as a fully sync'd peer.
   *
   * This means that we consider ourselves synced (and hence subscribe to all subnets and block
   * gossip if no peers are further than this range ahead of us that we have not already downloaded
   * blocks for.
   */
  private readonly slotImportTolerance: Slot;

  constructor(opts: SyncOptions, modules: ISyncModules) {
    const {config, chain, metrics, network, logger} = modules;
    this.opts = opts;
    this.config = config;
    this.network = network;
    this.chain = chain;
    this.metrics = metrics;
    this.logger = logger;
    this.slotImportTolerance = SLOTS_PER_EPOCH;

    // Subscribe to RangeSync completing a SyncChain and recompute sync state
    if (!opts.disableRangeSync) {
      this.network.events.on(NetworkEvent.peerConnected, this.addPeer);
      this.network.events.on(NetworkEvent.peerDisconnected, this.removePeer);
    }
    // TODO: It's okay to start this on initial sync?
    this.chain.emitter.on(ChainEvent.clockEpoch, this.onClockEpoch);

    if (metrics) {
      metrics.syncStatus.addCollect(() => this.scrapeMetrics(metrics));
    }
  }

  close(): void {
    this.network.events.off(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.off(NetworkEvent.peerDisconnected, this.removePeer);
    this.chain.emitter.off(ChainEvent.clockEpoch, this.onClockEpoch);
  }

  getSyncStatus(): SyncingStatus {
    // TODO DA Update to a LC specific implementation
    throw new Error("not implemented");
  }

  isSyncing(): boolean {
    // TODO DA Update to a LC specific implementation
    throw new Error("not implemented");
  }

  isSynced(): boolean {
    // TODO DA Update to a LC specific implementation
    throw new Error("not implemented");
  }

  get state(): SyncState {
    // TODO DA Update to a LC specific implementation
    throw new Error("not implemented");
  }

  /** Full debug state for lodestar API */
  getSyncChainsDebugState(): SyncChainDebugState[] {
    // TODO DA Update to a LC specific implementation
    throw new Error("not implemented");
  }

  private addPeer = (_peerId: PeerId, _peerStatus: phase0.Status): void => {
    // TODO DA Update to a LC specific implementation
    throw new Error("not implemented");
  };

  /**
   * Must be called by libp2p when a peer is removed from the peer manager
   */
  private removePeer = (peerId: PeerId): void => {
    // TODO DA Update to a LC specific implementation
    throw new Error("not implemented");
  };

  /**
   * Run this function when the sync state can potentially change.
   */
  private updateSyncState = (): void => {
    const state = this.state; // Don't run the getter twice

    // We have become synced, subscribe to all the gossip core topics
    if (
      state === SyncState.Synced &&
      !this.network.isSubscribedToGossipCoreTopics() &&
      this.chain.clock.currentSlot >= MIN_EPOCH_TO_START_GOSSIP
    ) {
      this.network.subscribeGossipCoreTopics();
      this.metrics?.syncSwitchGossipSubscriptions.inc({action: "subscribed"});
      this.logger.info("Subscribed gossip core topics");
    }

    // If we stopped being synced and falled significantly behind, stop gossip
    if (state !== SyncState.Synced && this.network.isSubscribedToGossipCoreTopics()) {
      const syncDiff = this.chain.clock.currentSlot - this.chain.forkChoice.getHead().slot;
      if (syncDiff > this.slotImportTolerance * 2) {
        this.logger.warn(`Node sync has fallen behind by ${syncDiff} slots`);
        this.network.unsubscribeGossipCoreTopics();
        this.metrics?.syncSwitchGossipSubscriptions.inc({action: "unsubscribed"});
        this.logger.info("Un-subscribed gossip core topics");
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

  private scrapeMetrics(_metrics: IMetrics): void {
    // Compute current sync state
    // TODO DA Update to a LC specific implementation
    throw new Error("not implemented");
  }
}
