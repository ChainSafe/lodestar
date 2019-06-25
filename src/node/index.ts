/**
 * @module node
 */

import deepmerge from "deepmerge";
import {BeaconDB, LevelDbController} from "../db";
import {EthersEth1Notifier, EthersEth1Options, IEth1Notifier} from "../eth1";
import {Libp2pNetwork, INetworkOptions, NodejsNode, INetwork} from "../network";


import defaultConf from "./defaults";
import {isPlainObject} from "../util/objects";
import {Sync} from "../sync";
import {BeaconChain, IBeaconChain} from "../chain";
import {OpPool} from "../opPool";
import {JSONRPC} from "../rpc/protocol";
import {WSServer} from "../rpc/transport";
import {IApiConstructor} from "../rpc/api/interface";
import {DBOptions} from '../db';
import {createPeerId, initializePeerInfo} from "../network/libp2p/util";
import {ILogger} from "../logger";
import {ReputationStore} from "../sync/reputation";


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
  public network: INetwork;
  public chain: IBeaconChain;
  public opPool: OpPool;
  public rpc: Service;
  public sync: Sync;
  public reps: ReputationStore;
  private logger: ILogger;

  public constructor(opts: BeaconNodeCtx, {logger}: {logger: ILogger}) {

    this.conf = deepmerge(
      defaultConf,
      opts,
      {
        //clone doesn't work very vell on classes like ethers.Provider
        isMergeableObject: isPlainObject
      }
    );
    this.logger = logger;

    this.reps = new ReputationStore();
    this.db = new BeaconDB({
      controller: new LevelDbController(this.conf.db, {
        logger: this.logger,
      }),
    });
    const libp2p = createPeerId()
      .then((peerId) => initializePeerInfo(peerId, this.conf.network.multiaddrs))
      .then((peerInfo) => new NodejsNode({peerInfo}));
    this.network = new Libp2pNetwork(this.conf.network, {
      libp2p: libp2p,
      logger: this.logger,
    });
    this.eth1 = new EthersEth1Notifier(this.conf.eth1, {
      opPool: this.opPool,
      logger: this.logger
    });
    this.chain = new BeaconChain(this.conf.chain, {
      db: this.db,
      eth1: this.eth1,
      logger: this.logger
    });
    this.opPool = new OpPool(this.conf.opPool, {
      db: this.db,
      chain: this.chain,
    });
    this.sync = new Sync(this.conf.sync, {
      db: this.db,
      eth1: this.eth1,
      chain: this.chain,
      opPool: this.opPool,
      network: this.network,
      reps: this.reps,
      logger: this.logger,
    });
    this.rpc = new JSONRPC(this.conf.rpc, {
      transports: [new WSServer(this.conf.rpc)],
      apis: this.conf.rpc.apis.map((Api) => {
        return new Api(this.conf.rpc, {chain: this.chain, db: this.db});
      })
    });

  }

  public async start(): Promise<void> {
    this.logger.info('Starting eth2 beacon node - LODESTAR!');
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
