/**
 * @module sync
 */

import {EventEmitter} from "events";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {OpPool} from "../opPool";
import {IEth1Notifier} from "../eth1";
import {IBeaconDb} from "../db";
import {RegularSync} from "./regular";
import {InitialSync} from "./initial";
import {ReputationStore} from "./reputation";
import {ILogger} from "../logger";
import {ISyncOptions} from "./options";
import {ISyncRpc} from "./rpc/interface";

interface SyncModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  db: IBeaconDb;
  eth1: IEth1Notifier;
  network: INetwork;
  opPool: OpPool;
  reps: ReputationStore;
  rpc: ISyncRpc;
  logger: ILogger;
}

/**
 * The Sync service syncing data between the network and the local chain
 * The strategy may differ depending on whether the chain is synced or not
 */
export class Sync extends EventEmitter {
  private opts: ISyncOptions;
  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private network: INetwork;
  private opPool: OpPool;
  private eth1: IEth1Notifier;
  private db: IBeaconDb;
  private rpc: ISyncRpc;
  private reps: ReputationStore;
  private logger: ILogger;
  private syncer: RegularSync;

  public constructor(opts: ISyncOptions, {config, chain, db, eth1, network, opPool, reps, rpc, logger}: SyncModules) {
    super();
    this.opts = opts;
    this.config = config;
    this.chain = chain;
    this.db = db;
    this.eth1 = eth1;
    this.network = network;
    this.opPool = opPool;
    this.reps = reps;
    this.logger = logger;
    this.rpc = rpc;
  }

  public async isSynced(): Promise<boolean> {
    if (!await this.chain.isInitialized()) {
      return true;
    }
    try {
      const bestSlot = await this.db.chain.getChainHeadSlot();
      const bestSlotByPeers = this.network.getPeers()
        .map((peerInfo) => this.reps.get(peerInfo.id.toB58String()))
        .map((reputation) => reputation.latestHello ? reputation.latestHello.bestSlot : 0)
        .reduce((a, b) => Math.max(a, b), 0);
      if (bestSlot >= bestSlotByPeers) {
        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  public async start(): Promise<void> {
    await this.rpc.start();
    await this.rpc.refreshPeerHellos();
    if (!await this.isSynced()) {
      const initialSync = new InitialSync(this.opts, {
        config: this.config,
        db: this.db,
        chain: this.chain,
        rpc: this.rpc,
        network: this.network,
        reps: this.reps,
        logger: this.logger,
      });
      await initialSync.start();
      await initialSync.stop();
    }
    this.syncer = new RegularSync(this.opts, {
      config: this.config,
      db: this.db,
      chain: this.chain,
      network: this.network,
      opPool: this.opPool,
      logger: this.logger,
    });
    this.syncer.start();
  }

  public async stop(): Promise<void> {
    await this.rpc.stop();
    await this.syncer.stop();
  }
}
