/**
 * @module node
 */

import deepmerge from "deepmerge";
import {BeaconDB, LevelDbController} from "../db";
import {EthersEth1Notifier, EthersEth1Options, IEth1Notifier} from "../eth1";
import {Libp2pNetwork, INetworkOptions, NodejsNode} from "../network";


import defaultConf from "./defaults";
import logger from "../logger/winston";
import {isPlainObject} from "../util/objects";
import {Sync} from "../sync";
import {BeaconChain} from "../chain";
import {OpPool} from "../opPool";
import {JSONRPC} from "../rpc/protocol";
import {WSServer} from "../rpc/transport";
import {IApiConstructor} from "../rpc/api/interface";
import {DBOptions} from '../db';
import {createPeerId, initializePeerInfo} from "../network/libp2p/util";


export interface Service {
  start(): Promise<void>;

  stop(): Promise<void>;
}

// Temporarily have properties be optional until others portions of lodestar are ready
export interface BeaconNodeCtx {
  chain?: object;
  db?: DBOptions;
  eth1?: EthersEth1Options;
  network?: INetworkOptions;
  rpc?: RpcCtx;
  sync?: object;
  opPool?: object;
}

interface RpcCtx {
  apis?: IApiConstructor[];
}

/**
 * Beacon Node configured for desktop (non-browser) use
 */
class BeaconNode {
  public conf: BeaconNodeCtx;
  public db: BeaconDB;
  public eth1: IEth1Notifier;
  public network: Service;
  public chain: BeaconChain;
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

    this.db = new BeaconDB({
      controller: new LevelDbController(
        this.conf.db
      )
    });
    const libp2p = createPeerId()
      .then((peerId) => initializePeerInfo(peerId, this.conf.network.multiaddrs))
      .then((peerInfo) => new NodejsNode({peerInfo}));
    this.network = new Libp2pNetwork(this.conf.network, {libp2p});
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
        return new Api(this.conf.rpc, {chain: this.chain, db: this.db, eth1: this.eth1});
      })
    });
  }

  public async start(): Promise<void> {
    logger.info('Starting eth2 beacon node - LODESTAR!');
    await this.db.start();
    await this.network.start();
    await this.eth1.start();
    await this.chain.start();
    await this.opPool.start();
    await this.sync.start();
    await this.rpc.start();
  }

  public async stop(): Promise<void> {
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
