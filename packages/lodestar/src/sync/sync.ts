import PeerId from "peer-id";
import {IBeaconSync, ISyncModules} from "./interface";
import defaultOptions, {ISyncOptions} from "./options";
import {getSyncProtocols, getUnknownRootProtocols, INetwork} from "../network";
import {ILogger} from "@chainsafe/lodestar-utils";
import {sleep} from "@chainsafe/lodestar-utils";
import {CommitteeIndex, Root, Slot, SyncingStatus} from "@chainsafe/lodestar-types";
import {FastSync, InitialSync} from "./initial";
import {IRegularSync} from "./regular";
import {BeaconReqRespHandler, IReqRespHandler} from "./reqResp";
import {BeaconGossipHandler, IGossipHandler} from "./gossip";
import {AttestationCollector, createStatus, RoundRobinArray, syncPeersStatus} from "./utils";
import {IBeaconChain} from "../chain";
import {NaiveRegularSync} from "./regular/naive";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {List, toHexString} from "@chainsafe/ssz";

export enum SyncMode {
  WAITING_PEERS,
  INITIAL_SYNCING,
  REGULAR_SYNCING,
  SYNCED,
  STOPPED,
}

export class BeaconSync implements IBeaconSync {
  private readonly opts: ISyncOptions;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;

  private mode: SyncMode;
  private initialSync: InitialSync;
  private regularSync: IRegularSync;
  private reqResp: IReqRespHandler;
  private gossip: IGossipHandler;
  private attestationCollector: AttestationCollector;

  private statusSyncTimer?: NodeJS.Timeout;
  private peerCountTimer?: NodeJS.Timeout;

  constructor(opts: ISyncOptions, modules: ISyncModules) {
    this.opts = opts;
    this.config = modules.config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.initialSync = modules.initialSync || new FastSync(opts, modules);
    this.regularSync = modules.regularSync || new NaiveRegularSync(opts, modules);
    this.reqResp = modules.reqRespHandler || new BeaconReqRespHandler(modules);
    this.gossip =
      modules.gossipHandler || new BeaconGossipHandler(modules.chain, modules.network, modules.db, this.logger);
    this.attestationCollector = modules.attestationCollector || new AttestationCollector(modules.config, modules);
    this.mode = SyncMode.STOPPED;
  }

  public async start(): Promise<void> {
    this.mode = SyncMode.WAITING_PEERS as SyncMode;
    await this.reqResp.start();
    await this.attestationCollector.start();
    // so we don't wait indefinitely
    await this.waitForPeers();
    if (this.mode === SyncMode.STOPPED) {
      return;
    }
    this.peerCountTimer = setInterval(this.logPeerCount, 3 * this.config.params.SECONDS_PER_SLOT * 1000);
    await this.startInitialSync();
    await this.startRegularSync();
  }

  public async stop(): Promise<void> {
    if (this.peerCountTimer) {
      clearInterval(this.peerCountTimer);
    }
    if (this.mode === SyncMode.STOPPED) {
      return;
    }
    this.mode = SyncMode.STOPPED;
    this.chain.emitter.removeListener("block:unknownRoot", this.onUnknownBlockRoot);
    this.regularSync.removeListener("syncCompleted", this.syncCompleted);
    this.stopSyncTimer();
    await this.initialSync.stop();
    await this.regularSync.stop();
    await this.attestationCollector.stop();
    await this.reqResp.stop();
    await this.gossip.stop();
  }

  public async getSyncStatus(): Promise<SyncingStatus> {
    const headSlot = this.chain.forkChoice.getHead().slot;
    let target: Slot;
    let syncDistance: bigint;
    switch (this.mode) {
      case SyncMode.WAITING_PEERS:
        target = 0;
        syncDistance = BigInt(1);
        break;
      case SyncMode.INITIAL_SYNCING:
        target = await this.initialSync.getHighestBlock();
        syncDistance = BigInt(target) - BigInt(headSlot);
        break;
      case SyncMode.REGULAR_SYNCING:
        target = await this.regularSync.getHighestBlock();
        syncDistance = BigInt(target) - BigInt(headSlot);
        break;
      case SyncMode.SYNCED:
        target = headSlot;
        syncDistance = BigInt(0);
        break;
      default:
        throw new Error("Node is stopped, cannot get sync status");
    }
    return {
      headSlot: BigInt(target),
      syncDistance: syncDistance < 0 ? BigInt(0) : syncDistance,
    };
  }

  public isSynced(): boolean {
    return this.mode === SyncMode.SYNCED;
  }

  public async collectAttestations(slot: Slot, committeeIndex: CommitteeIndex): Promise<void> {
    if (!(this.mode === SyncMode.REGULAR_SYNCING || this.mode === SyncMode.SYNCED)) {
      throw new Error("Cannot collect attestations before regular sync");
    }
    await this.attestationCollector.subscribeToCommitteeAttestations(slot, committeeIndex);
  }

  private async startInitialSync(): Promise<void> {
    if (this.mode === SyncMode.STOPPED) return;
    this.mode = SyncMode.INITIAL_SYNCING;
    this.startSyncTimer(this.config.params.SLOTS_PER_EPOCH * this.config.params.SECONDS_PER_SLOT * 1000);
    await this.regularSync.stop();
    await this.initialSync.start();
  }

  private async startRegularSync(): Promise<void> {
    if (this.mode === SyncMode.STOPPED) return;
    this.mode = SyncMode.REGULAR_SYNCING;
    await this.initialSync.stop();
    this.startSyncTimer(3 * this.config.params.SECONDS_PER_SLOT * 1000);
    this.regularSync.on("syncCompleted", this.syncCompleted);
    this.chain.emitter.on("block:unknownRoot", this.onUnknownBlockRoot);
    await this.gossip.start();
    await this.regularSync.start();
  }

  private syncCompleted = async (): Promise<void> => {
    this.mode = SyncMode.SYNCED;
    this.stopSyncTimer();
    await this.network.handleSyncCompleted();
  };

  private startSyncTimer(interval: number): void {
    this.stopSyncTimer();
    this.statusSyncTimer = setInterval(() => {
      syncPeersStatus(this.network, createStatus(this.chain)).catch((e) => {
        this.logger.error("Error on syncPeersStatus", e);
      });
    }, interval);
  }

  private logPeerCount = (): void => {
    this.logger.info("Peer status", {
      activePeers: this.network.getPeers({connected: true}).length,
      syncPeers: this.getSyncPeers().length,
      unknownRootPeers: this.getUnknownRootPeers().length,
    });
  };

  private stopSyncTimer(): void {
    if (this.statusSyncTimer) clearInterval(this.statusSyncTimer);
  }

  private async waitForPeers(): Promise<void> {
    this.logger.info("Waiting for peers...");
    const minPeers = this.opts.minPeers ?? defaultOptions.minPeers;
    while (this.mode !== SyncMode.STOPPED && this.getSyncPeers().length < minPeers) {
      this.logger.warn(`Current peerCount=${this.getSyncPeers().length}, required = ${minPeers}`);
      await sleep(3000);
    }
  }

  private getSyncPeers(): PeerId[] {
    return this.getPeers(getSyncProtocols());
  }

  private getUnknownRootPeers(): PeerId[] {
    return this.getPeers(getUnknownRootProtocols());
  }

  private getPeers(protocols: string[]): PeerId[] {
    return this.network
      .getPeers({connected: true, supportsProtocols: protocols})
      .filter((peer) => {
        return !!this.network.peerMetadata.getStatus(peer.id) && this.network.peerRpcScores.getScore(peer.id) > 50;
      })
      .map((peer) => peer.id);
  }

  private onUnknownBlockRoot = async (root: Root): Promise<void> => {
    const peerBalancer = new RoundRobinArray(this.getUnknownRootPeers());
    let retry = 0;
    const maxRetry = this.getUnknownRootPeers().length;
    while (retry < maxRetry) {
      const peer = peerBalancer.next();
      if (!peer) {
        return;
      }
      try {
        const blocks = await this.network.reqResp.beaconBlocksByRoot(peer, [root] as List<Root>);
        if (blocks && blocks[0]) {
          this.logger.verbose(`Fould block ${blocks[0].message.slot} for root ${toHexString(root)}`);
          return await this.chain.receiveBlock(blocks[0]);
        }
      } catch (e) {
        this.logger.verbose("Failed to get unknown block root from peer", {
          blockRoot: toHexString(root),
          peer: peer.toB58String(),
          error: e.message,
          maxRetry,
          retry,
        });
      }
      retry++;
    }
    this.logger.error(`Failed to get unknown block root ${toHexString(root)}`);
  };
}
