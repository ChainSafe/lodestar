import PeerId from "peer-id";
import {IBeaconSync, ISyncModules} from "./interface";
import {ISyncOptions} from "./options";
import {INetwork} from "../network";
import {IReputationStore} from "./reputation";
import {sleep} from "../util/sleep";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {CommitteeIndex, Root, SignedBeaconBlock, Slot, SyncingStatus} from "@chainsafe/lodestar-types";
import {FastSync, InitialSync} from "./initial";
import {IRegularSync} from "./regular";
import {BeaconReqRespHandler, IReqRespHandler} from "./reqResp";
import {BeaconGossipHandler, IGossipHandler} from "./gossip";
import {AttestationCollector, createStatus, RoundRobinArray, syncPeersStatus} from "./utils";
import {IBeaconChain} from "../chain";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {RegularSyncV2} from "./regular/v2";

export enum SyncMode {
  WAITING_PEERS,
  INITIAL_SYNCING,
  REGULAR_SYNCING,
  SYNCED,
  STOPPED
}

export class BeaconSync implements IBeaconSync {

  private readonly opts: ISyncOptions;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;
  private readonly peerReputations: IReputationStore;

  private mode: SyncMode;
  private initialSync: InitialSync;
  private regularSync: IRegularSync;
  private reqResp: IReqRespHandler;
  private gossip: IGossipHandler;
  private attestationCollector: AttestationCollector;
  private startingBlock: Slot = 0;

  private statusSyncTimer: NodeJS.Timeout;

  constructor(opts: ISyncOptions, modules: ISyncModules) {
    this.opts = opts;
    this.config = modules.config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.peerReputations = modules.reputationStore;
    this.initialSync = modules.initialSync || new FastSync(opts, modules);
    this.regularSync = modules.regularSync || new RegularSyncV2(opts, modules);
    this.reqResp = modules.reqRespHandler || new BeaconReqRespHandler(modules);
    this.gossip = modules.gossipHandler ||
      new BeaconGossipHandler(modules.chain, modules.network, modules.db, this.logger);
    this.attestationCollector = modules.attestationCollector || new AttestationCollector(modules.config, modules);
    this.mode = SyncMode.STOPPED;
  }

  public async start(): Promise<void> {
    this.mode = SyncMode.WAITING_PEERS as SyncMode;
    await this.reqResp.start();
    await this.attestationCollector.start();
    this.chain.on("unknownBlockRoot", this.onUnknownBlockRoot);
    // so we don't wait indefinitely
    await this.waitForPeers();
    if(this.mode === SyncMode.STOPPED) {
      return;
    }
    await this.startInitialSync();
    await this.startRegularSync();
    this.mode = SyncMode.SYNCED;
    this.startingBlock = (await this.chain.getHeadBlock()).message.slot;
  }

  public async stop(): Promise<void> {
    if (this.mode === SyncMode.STOPPED) {
      return;
    }
    this.mode = SyncMode.STOPPED;
    this.chain.removeListener("unknownBlockRoot", this.onUnknownBlockRoot);
    this.regularSync.removeListener("syncCompleted", this.stopSyncTimer);
    this.stopSyncTimer();
    await this.initialSync.stop();
    await this.regularSync.stop();
    await this.attestationCollector.stop();
    await this.reqResp.stop();
    await this.gossip.stop();
  }

  public async getSyncStatus(): Promise<SyncingStatus> {
    const headSlot = BigInt((await this.chain.getHeadBlock()).message.slot);
    if(this.isSynced()) {
      return {
        headSlot,
        syncDistance: BigInt(0)
      };
    }
    let target: Slot = 0;
    if(this.mode === SyncMode.INITIAL_SYNCING) {
      target = await this.initialSync.getHighestBlock();
    } else {
      target = await this.regularSync.getHighestBlock();
    }
    return {
      headSlot: BigInt(target),
      syncDistance: target >= headSlot ? (BigInt(target) - headSlot) : BigInt(0)
    };
  }

  public isSynced(): boolean {
    return this.mode === SyncMode.SYNCED;
  }

  public collectAttestations(slot: Slot, committeeIndex: CommitteeIndex): void {
    if (!(this.mode === SyncMode.REGULAR_SYNCING || this.mode === SyncMode.SYNCED)) {
      throw new Error("Cannot collect attestations before regular sync");
    }
    this.attestationCollector.subscribeToCommitteeAttestations(slot, committeeIndex);
  }

  private async startInitialSync(): Promise<void> {
    if(this.mode === SyncMode.STOPPED) return;
    this.mode = SyncMode.INITIAL_SYNCING;
    this.startSyncTimer(this.config.params.SLOTS_PER_EPOCH * this.config.params.SECONDS_PER_SLOT * 1000);
    await this.regularSync.stop();
    await this.initialSync.start();
  }

  private async startRegularSync(): Promise<void> {
    if(this.mode === SyncMode.STOPPED) return;
    this.mode = SyncMode.REGULAR_SYNCING;
    await this.initialSync.stop();
    //sync statuses every 3 slots
    this.startSyncTimer(3 * this.config.params.SECONDS_PER_SLOT * 1000);
    this.regularSync.on("syncCompleted", this.stopSyncTimer.bind(this));
    await this.gossip.start();
    await this.regularSync.start();
  }

  private startSyncTimer(interval: number): void {
    this.stopSyncTimer();
    this.statusSyncTimer = setInterval(async () => {
      await syncPeersStatus(
        this.peerReputations,
        this.network,
        this.logger,
        createStatus(this.chain.forkChoice.head(), this.chain.currentForkDigest)
      );
    }, interval);
  }

  private stopSyncTimer(): void {
    if(this.statusSyncTimer) clearInterval(this.statusSyncTimer);
  }

  private async waitForPeers(): Promise<void> {
    this.logger.info("Waiting for peers...");
    while (this.mode !== SyncMode.STOPPED && this.getPeers().length < this.opts.minPeers) {
      this.logger.warn(`Current peerCount=${this.getPeers().length}, required = ${this.opts.minPeers}`);
      await sleep(3000);
    }
  }

  private getPeers(): PeerId[] {
    return this.network.getPeers()
      .filter((peer) => {
        return !!this.peerReputations.getFromPeerId(peer).latestStatus;
      });
  }

  private onUnknownBlockRoot = async (root: Root): Promise<void> => {
    const peerBalancer = new RoundRobinArray(this.getPeers());
    let peer = peerBalancer.next();
    let block: SignedBeaconBlock;
    while (!block && peer) {
      block = (await this.network.reqResp.beaconBlocksByRoot(peer, [root]))[0];
      peer = peerBalancer.next();
    }
    if(block) {
      await this.chain.receiveBlock(block);
    }
  };
}
