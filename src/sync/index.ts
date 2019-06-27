/**
 * @module sync
 */

import {EventEmitter} from "events";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {OpPool} from "../opPool";
import {IEth1Notifier} from "../eth1";
import {IBeaconDb} from "../db";
import {SyncRpc} from "./rpc";
import {RegularSync} from "./regular";
import {ReputationStore} from "./reputation";
import {ILogger} from "../logger";
import {ISyncOptions} from "./options";

interface SyncModules {
  chain: IBeaconChain;
  db: IBeaconDb;
  eth1: IEth1Notifier;
  network: INetwork;
  opPool: OpPool;
  reps: ReputationStore;
  logger: ILogger;
}

/**
 * The Sync service syncing data between the network and the local chain
 * The strategy may differ depending on whether the chain is synced or not
 */
export class Sync extends EventEmitter {
  private opts: ISyncOptions;
  private chain: IBeaconChain;
  private network: INetwork;
  private opPool: OpPool;
  private eth1: IEth1Notifier;
  private db: IBeaconDb;
  private rpc: SyncRpc;
  private reps: ReputationStore;
  private logger: ILogger;
  private syncer: RegularSync;

  public constructor(opts: ISyncOptions, {chain, db, eth1, network, opPool, reps, logger}: SyncModules) {
    super();
    this.opts = opts;
    this.chain = chain;
    this.db = db;
    this.eth1 = eth1;
    this.network = network;
    this.opPool = opPool;
    this.reps = reps;
    this.logger = logger;
    this.rpc = new SyncRpc(opts, {db, chain, network, reps, logger});
  }

  public async isSynced(): Promise<boolean> {
    if (!await this.eth1.isAfterEth2Genesis()) {
      return true;
    }
    try {
      const bestSlot = await this.db.getChainHeadSlot();
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
    if (await this.isSynced()) {
      this.syncer = new RegularSync(this.opts, {
        db: this.db,
        chain: this.chain,
        network: this.network,
        opPool: this.opPool,
        logger: this.logger,
      });
      this.syncer.start();
    } else {
      /*
      this.syncer = new InitialSync(this.opts, {
        db: this.db,
        chain: this.chain,
        network: this.network,
        opPool: this.opPool,
      });
       */
    }
  }

  public async stop(): Promise<void> {
    await this.rpc.stop();
    await this.syncer.stop();
  }
}
