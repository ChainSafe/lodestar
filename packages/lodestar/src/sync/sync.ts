import PeerId from "peer-id";
import {AbortController} from "abort-controller";
import {IBeaconSync, ISyncModules, SyncMode} from "./interface";
import {defaultSyncOptions, ISyncOptions} from "./options";
import {INetwork} from "../network";
import {ILogger} from "@chainsafe/lodestar-utils";
import {CommitteeIndex, Root, Slot, phase0} from "@chainsafe/lodestar-types";
import {IRegularSync} from "./regular";
import {BeaconGossipHandler} from "./gossip";
import {ChainEvent, IBeaconChain} from "../chain";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {List, toHexString} from "@chainsafe/ssz";
import {BlockError, BlockErrorCode} from "../chain/errors";
import {getPeersInitialSync} from "./utils/bestPeers";
import {ORARegularSync} from "./regular/oneRangeAhead/oneRangeAhead";
import {SyncChain, ProcessChainSegment, DownloadBeaconBlocksByRange, GetPeersAndTargetEpoch} from "./range/chain";
import {AttestationCollector, RoundRobinArray} from "./utils";
import {ScoreState} from "../network/peers";

export class BeaconSync implements IBeaconSync {
  private readonly opts: ISyncOptions;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;

  private mode: SyncMode;
  private regularSync: IRegularSync;
  private gossip: BeaconGossipHandler;
  private attestationCollector: AttestationCollector;

  // avoid finding same root at the same time
  private processingRoots: Set<string>;

  private controller = new AbortController();

  constructor(opts: ISyncOptions, modules: ISyncModules) {
    this.opts = opts;
    this.config = modules.config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.regularSync = modules.regularSync || new ORARegularSync(opts, modules);
    this.gossip =
      modules.gossipHandler || new BeaconGossipHandler(modules.config, modules.chain, modules.network, modules.db);
    this.attestationCollector = modules.attestationCollector || new AttestationCollector(modules.config, modules);
    this.mode = SyncMode.STOPPED;
    this.processingRoots = new Set();
  }

  async start(): Promise<void> {
    this.mode = SyncMode.WAITING_PEERS as SyncMode;
    this.attestationCollector.start();
    if (this.mode === SyncMode.STOPPED) {
      return;
    }

    this.mode = SyncMode.INITIAL_SYNCING;

    const finalizedBlock = this.chain.forkChoice.getFinalizedBlock();
    const startEpoch = finalizedBlock.finalizedEpoch;
    // Set state cache size to 1 during initial sync
    const maxStates = this.chain.stateCache.maxStates;
    this.chain.stateCache.maxStates = 1;
    const initialSync = new SyncChain(
      startEpoch,
      this.processChainSegment,
      this.downloadBeaconBlocksByRange,
      this.getPeersAndTargetEpoch,
      this.config,
      this.logger,
      this.controller.signal
    );

    initialSync
      .sync()
      .then(() => {
        // Reset state cache size after initial sync
        this.chain.stateCache.maxStates = maxStates;
        this.startRegularSync();
      })
      .catch((e) => {
        this.logger.error("Error on initial sync", {}, e);
      });

    // Hack while RangeSync is not merged
    // If a node witness the genesis event and has peers consider it synced and start gossip
    this.chain.emitter.on(ChainEvent.clockEpoch, (epoch) => {
      if (epoch === 0 && this.network.getConnectedPeers().length > 0) {
        this.initialSyncCompleted();
        this.regularSyncCompleted();
      }
    });
  }

  async stop(): Promise<void> {
    this.controller.abort();
    if (this.mode === SyncMode.STOPPED) {
      return;
    }
    this.mode = SyncMode.STOPPED;
    this.chain.emitter.off(ChainEvent.errorBlock, this.onUnknownBlockRoot);
    this.regularSync.off("syncCompleted", this.regularSyncCompleted);
    this.regularSync.stop();
    this.attestationCollector.stop();
    this.gossip.stop();
    this.gossip.close();
  }

  getSyncStatus(): phase0.SyncingStatus {
    const currentSlot = this.chain.clock.currentSlot;
    const headSlot = this.chain.forkChoice.getHead().slot;
    switch (this.mode) {
      case SyncMode.WAITING_PEERS:
      case SyncMode.INITIAL_SYNCING:
      case SyncMode.REGULAR_SYNCING:
        return {
          headSlot: BigInt(headSlot),
          syncDistance: BigInt(currentSlot - headSlot),
        };
      case SyncMode.SYNCED:
        return {
          headSlot: BigInt(headSlot),
          syncDistance: BigInt(0),
        };
      default:
        throw new Error("Node is stopped, cannot get sync status");
    }
  }

  isSynced(): boolean {
    return this.mode === SyncMode.SYNCED;
  }

  get state(): SyncMode {
    return this.mode;
  }

  collectAttestations(slot: Slot, committeeIndex: CommitteeIndex): void {
    if (!(this.mode === SyncMode.REGULAR_SYNCING || this.mode === SyncMode.SYNCED)) {
      throw new Error("Cannot collect attestations before regular sync");
    }
    this.attestationCollector.subscribeToCommitteeAttestations(slot, committeeIndex);
  }

  private processChainSegment: ProcessChainSegment = async (blocks) => {
    const trusted = false; // Verify signatures
    await this.chain.processChainSegment(blocks, trusted);
  };

  private downloadBeaconBlocksByRange: DownloadBeaconBlocksByRange = async (peerId, request) => {
    return await this.network.reqResp.beaconBlocksByRange(peerId, request);
  };

  private getPeersAndTargetEpoch: GetPeersAndTargetEpoch = () => {
    const minPeers = this.opts.minPeers ?? defaultSyncOptions.minPeers;
    const peerSet = getPeersInitialSync(this.network);
    if (!peerSet && minPeers === 0) {
      this.logger.verbose("minPeers=0, skipping initial sync");
      return {peers: [], targetEpoch: this.chain.forkChoice.getFinalizedBlock().finalizedEpoch};
    } else if (!peerSet || peerSet.peers.length < minPeers) {
      this.logger.verbose(`Waiting for minPeers: ${peerSet?.peers?.length ?? 0}/${minPeers}`);
      return null;
    } else {
      const targetEpoch = peerSet.checkpoint.epoch;
      this.logger.debug("New peer set", {count: peerSet.peers.length, targetEpoch});
      return {peers: peerSet.peers.map((p) => p.peerId), targetEpoch};
    }
  };

  private startRegularSync(): void {
    if (this.mode === SyncMode.STOPPED) return;
    this.regularSync.on("syncCompleted", this.regularSyncCompleted);
    this.regularSync.start();
    this.initialSyncCompleted();
  }

  private initialSyncCompleted = (): void => {
    this.mode = SyncMode.REGULAR_SYNCING;
    this.chain.emitter.off(ChainEvent.errorBlock, this.onUnknownBlockRoot);
    this.chain.emitter.on(ChainEvent.errorBlock, this.onUnknownBlockRoot);
    this.gossip.start();
  };

  private regularSyncCompleted = (): void => {
    this.mode = SyncMode.SYNCED;
    this.gossip.start();
  };

  private getSyncPeers(): PeerId[] {
    return this.getPeers();
  }

  private getUnknownRootPeers(): PeerId[] {
    return this.getPeers();
  }

  private getPeers(): PeerId[] {
    return this.network
      .getConnectedPeers()
      .filter(
        (peer) =>
          !!this.network.peerMetadata.status.get(peer) &&
          this.network.peerRpcScores.getScoreState(peer) === ScoreState.Healthy
      );
  }

  private onUnknownBlockRoot = async (err: BlockError): Promise<void> => {
    if (err.type.code !== BlockErrorCode.PARENT_UNKNOWN) return;

    const blockRoot = this.config.types.phase0.BeaconBlock.hashTreeRoot(err.job.signedBlock.message);
    const parentRoot = this.chain.pendingBlocks.getMissingAncestor(blockRoot);
    const parentRootHex = toHexString(parentRoot);

    if (this.processingRoots.has(parentRootHex)) {
      return;
    } else {
      this.processingRoots.add(parentRootHex);
      this.logger.verbose("Finding block for unknown ancestor root", {parentRootHex});
    }
    const peerBalancer = new RoundRobinArray(this.getUnknownRootPeers());
    let retry = 0;
    const maxRetry = this.getUnknownRootPeers().length;
    let found = false;
    while (retry < maxRetry) {
      const peer = peerBalancer.next();
      if (!peer) {
        break;
      }
      try {
        const blocks = await this.network.reqResp.beaconBlocksByRoot(peer, [parentRoot] as List<Root>);
        if (blocks[0]) {
          this.logger.verbose("Found block for root", {slot: blocks[0].message.slot, parentRootHex});
          found = true;
          this.chain.receiveBlock(blocks[0]);
          break;
        }
      } catch (e) {
        this.logger.verbose("Failed to get unknown ancestor root from peer", {
          parentRootHex,
          peer: peer.toB58String(),
          error: (e as Error).message,
          maxRetry,
          retry,
        });
      }
      retry++;
    } // end while
    this.processingRoots.delete(parentRootHex);
    if (!found) this.logger.error("Failed to get unknown ancestor root", {parentRootHex});
  };
}
