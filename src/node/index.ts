import deepmerge from "deepmerge";
import {LevelDB} from "../db";
import {EthersEth1Notifier} from "../eth1";
import {P2PNetwork} from "../p2p";

import defaultConf from "./defaults";
import logger from "../logger/winston";
import {isPlainObject} from "../util/objects";
import {Sync} from "../sync";
import {BeaconChain} from "../chain";
import {OpPool} from "../opPool";
import {JSONRPC} from "../rpc/protocol";
import {WSServer} from "../rpc/transport";
import {IApiConstructor} from "../rpc/api/interface";

export interface Service {
  start(): Promise<void>;

  stop(): Promise<void>;
}

// Temporarily have properties be optional until others portions of lodestar are ready
interface BeaconNodeCtx {
  chain?: object;
  db?: object;
  // Temporarily set to any. Will be changed to object later.
  eth1?: any;
  network?: any;
  rpc?: RpcCtx;
  sync?: object;
  opPool?: object;
}

interface RpcCtx {
  apis?: IApiConstructor[];
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
    this.conf = deepmerge(
      defaultConf,
      opts,
      {
        //clone doesn't work very vell on classes like ethers.Provider
        isMergeableObject: isPlainObject
      }
    );

    this.db = new LevelDB(this.conf.db);
    this.network = new P2PNetwork(this.conf.network);
    this.eth1 = new EthersEth1Notifier(
      this.conf.eth1,
      {
        db: this.db
      }
    );
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
      transports: [new WSServer(this.conf.rpc)],
      apis: this.conf.rpc.apis.map((Api) => {
        return new Api(this.conf.rpc, {chain: this.chain, db: this.db});
      })
    });
  }

  public async start() {
    logger.info('Starting eth2 beacon node - LODESTAR!');
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
