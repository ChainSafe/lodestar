import PeerId from "peer-id";
import {AbortController} from "abort-controller";
import {IBeaconSync, ISyncModules, SyncMode} from "./interface";
import {defaultSyncOptions, ISyncOptions} from "./options";
import {getSyncProtocols, getUnknownRootProtocols, INetwork} from "../network";
import {ILogger} from "@chainsafe/lodestar-utils";
import {CommitteeIndex, Root, Slot, SyncingStatus} from "@chainsafe/lodestar-types";
import {IRegularSync} from "./regular";
import {BeaconReqRespHandler, IReqRespHandler} from "./reqResp";
import {BeaconGossipHandler, IGossipHandler} from "./gossip";
import {ChainEvent, IBeaconChain} from "../chain";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {List, toHexString} from "@chainsafe/ssz";
import {BlockError, BlockErrorCode} from "../chain/errors";
import {getPeersInitialSync} from "./utils/bestPeers";
import {ORARegularSync} from "./regular/oneRangeAhead/oneRangeAhead";
import {SyncChain, ProcessChainSegment, DownloadBeaconBlocksByRange, GetPeersAndTargetEpoch} from "./range/chain";
import {assertSequentialBlocksInRange, AttestationCollector, RoundRobinArray, syncPeersStatus} from "./utils";

export class BeaconSync implements IBeaconSync {
  private readonly opts: ISyncOptions;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;

  private mode: SyncMode;
  private regularSync: IRegularSync;
  private reqResp: IReqRespHandler;
  private gossip: IGossipHandler;
  private attestationCollector: AttestationCollector;

  private statusSyncTimer?: NodeJS.Timeout;
  private peerCountTimer?: NodeJS.Timeout;
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
    this.reqResp = modules.reqRespHandler || new BeaconReqRespHandler(modules);
    this.gossip =
      modules.gossipHandler || new BeaconGossipHandler(modules.chain, modules.network, modules.db, this.logger);
    this.attestationCollector = modules.attestationCollector || new AttestationCollector(modules.config, modules);
    this.mode = SyncMode.STOPPED;
    this.processingRoots = new Set();
  }

  public async start(): Promise<void> {
    this.mode = SyncMode.WAITING_PEERS as SyncMode;
    await this.reqResp.start();
    await this.attestationCollector.start();
    if (this.mode === SyncMode.STOPPED) {
      return;
    }
    this.peerCountTimer = setInterval(this.logPeerCount, 3 * this.config.params.SECONDS_PER_SLOT * 1000);

    if ((this.mode as SyncMode) === SyncMode.STOPPED) return;
    this.mode = SyncMode.INITIAL_SYNCING;
    this.startSyncTimer(this.config.params.SLOTS_PER_EPOCH * this.config.params.SECONDS_PER_SLOT * 1000);

    const finalizedBlock = this.chain.forkChoice.getFinalizedBlock();
    const startEpoch = finalizedBlock.finalizedEpoch;
    const initialSync = new SyncChain(
      startEpoch,
      this.processChainSegment,
      this.downloadBeaconBlocksByRange,
      this.getPeersAndTargetEpoch,
      this.config,
      this.logger,
      this.controller.signal
    );

    await initialSync.sync();

    await this.startRegularSync();
  }

  public async stop(): Promise<void> {
    this.controller.abort();
    if (this.peerCountTimer) {
      clearInterval(this.peerCountTimer);
    }
    if (this.mode === SyncMode.STOPPED) {
      return;
    }
    this.mode = SyncMode.STOPPED;
    this.chain.emitter.off(ChainEvent.errorBlock, this.onUnknownBlockRoot);
    this.regularSync.off("syncCompleted", this.syncCompleted);
    this.stopSyncTimer();
    await this.regularSync.stop();
    await this.attestationCollector.stop();
    await this.reqResp.stop();
    await this.gossip.stop();
  }

  public async getSyncStatus(): Promise<SyncingStatus> {
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

  public isSynced(): boolean {
    return this.mode === SyncMode.SYNCED;
  }

  get state(): SyncMode {
    return this.mode;
  }

  public async collectAttestations(slot: Slot, committeeIndex: CommitteeIndex): Promise<void> {
    if (!(this.mode === SyncMode.REGULAR_SYNCING || this.mode === SyncMode.SYNCED)) {
      throw new Error("Cannot collect attestations before regular sync");
    }
    await this.attestationCollector.subscribeToCommitteeAttestations(slot, committeeIndex);
  }

  private processChainSegment: ProcessChainSegment = async (blocks) => {
    const trusted = true; // TODO: Verify signatures
    await this.chain.processChainSegment(blocks, trusted);
  };

  private downloadBeaconBlocksByRange: DownloadBeaconBlocksByRange = async (peerId, request) => {
    const blocks = await this.network.reqResp.beaconBlocksByRange(peerId, request);
    assertSequentialBlocksInRange(blocks, request);
    return blocks;
  };

  private getPeersAndTargetEpoch: GetPeersAndTargetEpoch = () => {
    const minPeers = this.opts.minPeers ?? defaultSyncOptions.minPeers;
    const peerSet = getPeersInitialSync(this.network);
    if (!peerSet && minPeers === 0) {
      this.logger.info("minPeers=0, skipping initial sync");
      return {peers: [], targetEpoch: this.chain.forkChoice.getFinalizedBlock().finalizedEpoch};
    } else if (!peerSet || peerSet.peers.length < minPeers) {
      this.logger.info(`Waiting for minPeers: ${peerSet?.peers?.length ?? 0}/${minPeers}`);
      return null;
    } else {
      const targetEpoch = peerSet.checkpoint.epoch;
      this.logger.debug("New peer set", {count: peerSet.peers.length, targetEpoch});
      return {peers: peerSet.peers.map((p) => p.peerId), targetEpoch};
    }
  };

  private async startRegularSync(): Promise<void> {
    if (this.mode === SyncMode.STOPPED) return;
    this.mode = SyncMode.REGULAR_SYNCING;
    this.startSyncTimer(3 * this.config.params.SECONDS_PER_SLOT * 1000);
    this.regularSync.on("syncCompleted", this.syncCompleted);
    this.chain.emitter.on(ChainEvent.errorBlock, this.onUnknownBlockRoot);
    await this.gossip.start();
    await this.regularSync.start();
  }

  private syncCompleted = async (): Promise<void> => {
    this.mode = SyncMode.SYNCED;
    this.stopSyncTimer();
    this.gossip.handleSyncCompleted();
    await this.network.handleSyncCompleted();
  };

  private startSyncTimer(interval: number): void {
    this.stopSyncTimer();
    this.statusSyncTimer = setInterval(async () => {
      try {
        await syncPeersStatus(this.network, this.chain.getStatus());
      } catch (e) {
        this.logger.error("Error on syncPeersStatus", e);
      }
    }, interval);
  }

  private logPeerCount = (): void => {
    this.logger.info("Peer status", {
      activePeers: this.network.getPeers().length,
      syncPeers: this.getSyncPeers().length,
      unknownRootPeers: this.getUnknownRootPeers().length,
    });
  };

  private stopSyncTimer(): void {
    if (this.statusSyncTimer) clearInterval(this.statusSyncTimer);
  }

  private getSyncPeers(): PeerId[] {
    return this.getPeers(getSyncProtocols());
  }

  private getUnknownRootPeers(): PeerId[] {
    return this.getPeers(getUnknownRootProtocols());
  }

  private getPeers(protocols: string[]): PeerId[] {
    return this.network
      .getPeers({supportsProtocols: protocols})
      .filter((peer) => {
        return !!this.network.peerMetadata.status.get(peer.id) && this.network.peerRpcScores.getScore(peer.id) > 50;
      })
      .map((peer) => peer.id);
  }

  private onUnknownBlockRoot = async (err: BlockError): Promise<void> => {
    if (err.type.code !== BlockErrorCode.PARENT_UNKNOWN) return;
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(err.job.signedBlock.message);
    const unknownAncestorRoot = this.chain.pendingBlocks.getMissingAncestor(blockRoot);
    const missingRootHex = toHexString(unknownAncestorRoot);
    if (this.processingRoots.has(missingRootHex)) {
      return;
    } else {
      this.processingRoots.add(missingRootHex);
      this.logger.verbose("Finding block for unknown ancestor root", {blockRoot: missingRootHex});
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
        const blocks = await this.network.reqResp.beaconBlocksByRoot(peer, [unknownAncestorRoot] as List<Root>);
        if (blocks[0]) {
          this.logger.verbose("Found block for root", {slot: blocks[0].message.slot, blockRoot: missingRootHex});
          found = true;
          await this.chain.receiveBlock(blocks[0]);
          break;
        }
      } catch (e) {
        this.logger.verbose("Failed to get unknown ancestor root from peer", {
          blockRoot: missingRootHex,
          peer: peer.toB58String(),
          error: e.message,
          maxRetry,
          retry,
        });
      }
      retry++;
    } // end while
    this.processingRoots.delete(missingRootHex);
    if (!found) this.logger.error("Failed to get unknown ancestor root", {blockRoot: missingRootHex});
  };
}
