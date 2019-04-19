import deepmerge from "deepmerge";

import {BeaconChain} from "../chain";
import {LevelDB} from "../db";
import {EthersEth1Notifier} from "../eth1";
import {P2PNetwork} from "../p2p";
import {BeaconAPI, JSONRPC, WSServer} from "../rpc";
import {Sync} from "../sync";
import {OpPool} from "../opPool";

import defaultConf from "./defaults";

export interface Service {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface BeaconNodeCtx {
  chain: object;
  db: object;
  eth1: object;
  network: any;
  rpc: object;
  sync: object;
  opPool: object;
}

class BeaconNode {
  public conf: BeaconNodeCtx;
  public db: Service;
  public eth1: Service;
  public network: Service;
  public chain: Service;
  public opPool: Service;
  public rpc: Service;
  public sync: Service;

  public constructor(opts: BeaconNodeCtx) {
    this.conf = deepmerge(defaultConf, opts);

    // this.logger ?
    this.db = new LevelDB(this.conf.db);
    this.network = new P2PNetwork(this.conf.network);
    this.eth1 = new EthersEth1Notifier(this.conf.eth1);
    this.sync = new Sync(this.conf.sync, {
      network: this.network,
    });
    this.chain = new BeaconChain(this.conf.chain, {
      db: this.db,
      eth1: this.eth1,
    });
    this.opPool = new OpPool(this.conf.opPool, {
      db: this.db,
      chain: this.chain,
    });
    this.rpc = new JSONRPC(this.conf.rpc, {
      transport: new WSServer(this.conf.rpc),
      api: new BeaconAPI(this.conf.rpc, {
        chain: this.chain,
        db: this.db,
        opPool: this.opPool,
      }),
    });
  }

  public async start() {
    await this.db.start();
    await this.network.start();
    await this.eth1.start();
    await this.chain.start();
    await this.opPool.start();
    await this.sync.start();
    await this.rpc.start();
  }

  public async stop() {
    await this.rpc.stop();
    await this.sync.stop();
    await this.opPool.stop();

    await this.chain.stop();
    await this.eth1.stop();
    await this.network.stop();
    await this.db.stop();
  }
}

export default BeaconNode;
