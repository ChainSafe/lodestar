import PeerId from "peer-id";
import {IBeaconSync, ISyncModules} from "./interface";
import {INetwork, NetworkEvent} from "../network";
import {ILogger} from "@chainsafe/lodestar-utils";
import {CommitteeIndex, Slot, phase0} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {ChainEvent, IBeaconChain} from "../chain";
import {BlockError, BlockErrorCode} from "../chain/errors";
import {BeaconGossipHandler} from "./gossip";
import {RangeSync, RangeSyncStatus, RangeSyncEvent} from "./range/range";
import {AttestationCollector, fetchUnknownBlockRoot, getPeerSyncType, PeerSyncType} from "./utils";
import {SyncState, SyncChainDebugState} from "./interface";

export type SyncOptions = Record<string, never>;

export class BeaconSync implements IBeaconSync {
  private readonly logger: ILogger;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;

  private prevState: SyncState = SyncState.Stalled;
  private readonly rangeSync: RangeSync;
  private readonly gossip: BeaconGossipHandler;
  private readonly attestationCollector: AttestationCollector;

  // avoid finding same root at the same time
  private readonly processingRoots = new Set<string>();

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
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.rangeSync = new RangeSync(modules);
    this.gossip =
      modules.gossipHandler || new BeaconGossipHandler(modules.config, modules.chain, modules.network, modules.db);
    this.attestationCollector = modules.attestationCollector || new AttestationCollector(modules.config, modules);
    this.slotImportTolerance = modules.config.params.SLOTS_PER_EPOCH;

    this.rangeSync.on(RangeSyncEvent.completedChain, this.updateSyncState);
    this.network.events.on(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.on(NetworkEvent.peerDisconnected, this.removePeer);
    // TODO: It's okay to start this on initial sync?
    this.chain.emitter.on(ChainEvent.errorBlock, this.onUnknownBlockRoot);
    this.attestationCollector.start();
  }

  close(): void {
    this.network.events.off(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.off(NetworkEvent.peerDisconnected, this.removePeer);

    this.chain.emitter.off(ChainEvent.errorBlock, this.onUnknownBlockRoot);
    this.rangeSync.close();
    this.attestationCollector.stop();
    this.gossip.stop();
    this.gossip.close();
  }

  getSyncStatus(): phase0.SyncingStatus {
    const currentSlot = this.chain.clock.currentSlot;
    const headSlot = this.chain.forkChoice.getHead().slot;
    switch (this.state) {
      case SyncState.SyncingFinalized:
      case SyncState.SyncingHead:
      case SyncState.Stalled:
        return {
          headSlot: BigInt(headSlot),
          syncDistance: BigInt(currentSlot - headSlot),
        };
      case SyncState.Synced:
        return {
          headSlot: BigInt(headSlot),
          syncDistance: BigInt(0),
        };
      default:
        throw new Error("Node is stopped, cannot get sync status");
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
      currentSlot >= headSlot &&
      headSlot >= currentSlot - this.slotImportTolerance
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
    }
  }

  collectAttestations(slot: Slot, committeeIndex: CommitteeIndex): void {
    if (!(this.state === SyncState.SyncingHead || this.state === SyncState.Synced)) {
      throw new Error("Cannot collect attestations before regular sync");
    }
    this.attestationCollector.subscribeToCommitteeAttestations(slot, committeeIndex);
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
  private addPeer = (peerId: PeerId, peerStatus: phase0.Status): void => {
    const localStatus = this.chain.getStatus();
    const syncType = getPeerSyncType(localStatus, peerStatus, this.chain, this.slotImportTolerance);

    if (syncType === PeerSyncType.Advanced) {
      this.rangeSync.addPeer(peerId, localStatus, peerStatus);
    }

    this.updateSyncState();
  };

  /**
   * Must be called by libp2p when a peer is removed from the peer manager
   */
  private removePeer = (peerId: PeerId): void => {
    this.rangeSync.removePeer(peerId);
  };

  /**
   * Subscribe to RangeSync completing a SyncChain and recompute sync state
   */
  private updateSyncState = (): void => {
    const prevState = this.prevState;
    const currentState = this.state;
    this.prevState = currentState;

    if (prevState !== SyncState.Synced && currentState === SyncState.Synced) {
      // We have become synced, subscribe to all the gossip core topics
      this.gossip.start();
      this.logger.info("Subscribed gossip handlers");
    } else if (prevState === SyncState.Synced && currentState !== SyncState.Synced) {
      // If we stopped being synced and falled significantly behind, stop gossip
      const currentSlot = this.chain.clock.currentSlot;
      const headSlot = this.chain.forkChoice.getHead().slot;
      if (headSlot < currentSlot - this.slotImportTolerance * 2) {
        this.gossip.stop();
        this.logger.warn("Un-subscribed gossip handlers");
      }
    }
  };

  private onUnknownBlockRoot = async (err: BlockError): Promise<void> => {
    if (err.type.code !== BlockErrorCode.PARENT_UNKNOWN) {
      return;
    }

    const parentRoot = err.type.parentRoot;
    const parentRootHex = toHexString(parentRoot);

    if (this.processingRoots.has(parentRootHex)) {
      return;
    }

    this.processingRoots.add(parentRootHex);
    this.logger.verbose("Finding block for unknown ancestor root", {parentRootHex});

    try {
      const block = await fetchUnknownBlockRoot(parentRoot, this.network);
      this.chain.receiveBlock(block);
      this.logger.verbose("Found UnknownBlockRoot", {parentRootHex});
    } catch (e) {
      this.logger.verbose("Error fetching UnknownBlockRoot", {parentRootHex}, e);
    } finally {
      this.processingRoots.delete(parentRootHex);
    }
  };
}
