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
import {ILogger} from "../logger";
import {ISyncOptions} from "./options";
import {ISyncReqResp, SyncReqResp} from "./reqResp";
import {ReputationStore} from "./IReputation";
import {Slot} from "@chainsafe/eth2.0-types";

export interface ISyncModules {
  config: IBeaconConfig;
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
  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private network: INetwork;
  private opPool: OpPool;
  private eth1: IEth1Notifier;
  private db: IBeaconDb;
  private reqResp: ISyncReqResp;
  private reps: ReputationStore;
  private logger: ILogger;
  //@ts-ignore
  private syncer: RegularSync;

  public constructor(opts: ISyncOptions, modules: ISyncModules) {
    super();
    this.opts = opts;
    this.config = modules.config;
    this.chain = modules.chain;
    this.db = modules.db;
    this.eth1 = modules.eth1;
    this.network = modules.network;
    this.opPool = modules.opPool;
    this.reps = modules.reps;
    this.logger = modules.logger;
    this.reqResp = new SyncReqResp(opts, modules);
  }

  public isSynced = async(): Promise<boolean> => {
    if (!await this.chain.isInitialized()) {
      return true;
    }
    try {
      const bestSlot = await this.db.chain.getChainHeadSlot();
      const bestSlotByPeers = this.network.getPeers()
        .map((peerInfo) => this.reps.get(peerInfo.id.toB58String()))
        .map((reputation) => {
          return reputation.latestHello ? reputation.latestHello.headSlot : 0
        })
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
    //await new Promise((resolve) => this.network.once("peer:connect", resolve));
    await this.reqResp.start();
    if (!await this.isSynced()) {
      this.logger.info("Chain not synced, running initial sync...");
      const initialSync = new InitialSync(this.opts, {
        config: this.config,
        db: this.db,
        chain: this.chain,
        network: this.network,
        reps: this.reps,
        logger: this.logger,
      });
      await initialSync.start();
      await initialSync.stop();
    }
    this.logger.info("Chain synced, running regular sync...");
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
    await this.reqResp.stop();
    await this.syncer.stop();
  }
}
