/**
 * @module node
 */

import deepmerge from "deepmerge";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {BeaconDb, LevelDbController} from "../db";
import defaultConf, {IBeaconNodeOptions} from "./options";
import {EthersEth1Notifier, IEth1Notifier} from "../eth1";
import {INetwork, Libp2pNetwork, NodejsNode} from "../network";
import {isPlainObject} from "../util/objects";
import {Sync} from "../sync";
import {BeaconChain, IBeaconChain} from "../chain";
import {OpPool} from "../opPool";
import {createPeerId, initializePeerInfo} from "../network/libp2p/util";
import {ILogger} from "../logger";
import {ReputationStore} from "../sync/reputation";
import {SyncRpc} from "../network/libp2p/syncRpc";
import {BeaconMetrics, HttpMetricsServer} from "../metrics";
import {ApiService} from "../api";

export interface Service {
  start(): Promise<void>;

  stop(): Promise<void>;
}

interface BeaconNodeModules {
  config: IBeaconConfig;
  logger: ILogger;
  eth1?: IEth1Notifier;
}

// TODO move into src/node/beacon
/**
 * Beacon Node configured for desktop (non-browser) use
 */
export class BeaconNode {
  public conf: IBeaconNodeOptions;
  public config: IBeaconConfig;
  public db: BeaconDb;
  public metrics: BeaconMetrics;
  public metricsServer: HttpMetricsServer;
  public eth1: IEth1Notifier;
  public network: INetwork;
  public chain: IBeaconChain;
  public opPool: OpPool;
  public api: Service;
  public sync: Sync;
  public reps: ReputationStore;
  private logger: ILogger;

  public constructor(opts: Partial<IBeaconNodeOptions>, {config, logger, eth1}: BeaconNodeModules) {
    this.conf = deepmerge(
      defaultConf,
      opts,
      {
        //clone doesn't work very vell on classes like ethers.Provider
        isMergeableObject: isPlainObject
      }
    );
    this.config = config;
    this.logger = logger.child(this.conf.logger.node);
    this.metrics = new BeaconMetrics(this.conf.metrics);
    this.metricsServer = new HttpMetricsServer(this.conf.metrics, {metrics: this.metrics});
    this.reps = new ReputationStore();
    this.db = new BeaconDb({
      config,
      controller: new LevelDbController(this.conf.db, {
        logger: logger.child(this.conf.logger.db),
      }),
    });
    // TODO initialize outside node
    // initialize for network type
    const libp2p = createPeerId()
      .then((peerId) => initializePeerInfo(peerId, this.conf.network.multiaddrs))
      .then((peerInfo) => new NodejsNode({peerInfo}));

    this.network = new Libp2pNetwork(this.conf.network, {
      config,
      libp2p: libp2p,
      logger: logger.child(this.conf.logger.network),
      metrics: this.metrics,
    });
    this.eth1 = eth1 || new EthersEth1Notifier(this.conf.eth1, {
      config,
      logger: logger.child(this.conf.logger.eth1),
    });
    this.opPool = new OpPool(this.conf.opPool, {
      eth1: this.eth1,
      db: this.db
    });
    this.chain = new BeaconChain(this.conf.chain, {
      config,
      db: this.db,
      eth1: this.eth1,
      opPool: this.opPool,
      logger: logger.child(this.conf.logger.chain),
      metrics: this.metrics,
    });

    const rpc = new SyncRpc(this.conf.sync, {
      config,
      db: this.db,
      chain: this.chain,
      network: this.network,
      reps: this.reps,
      logger: logger.child(this.conf.logger.network),
    });
    this.sync = new Sync(this.conf.sync, {
      config,
      db: this.db,
      eth1: this.eth1,
      chain: this.chain,
      opPool: this.opPool,
      network: this.network,
      reps: this.reps,
      rpc,
      logger: logger.child(this.conf.logger.sync),
    });
    this.api = new ApiService(
      this.conf.api,
      {
        config,
        logger: this.logger,
        opPool: this.opPool,
        db: this.db,
        sync: this.sync,
        chain: this.chain,
        eth1: this.eth1
      }
    );

  }

  public async start(): Promise<void> {
    this.logger.info('Starting eth2 beacon node - LODESTAR!');
    await this.metrics.start();
    await this.metricsServer.start();
    await this.db.start();
    await this.network.start();
    await this.eth1.start();
    await this.chain.start();
    await this.opPool.start();
    await this.sync.start();
    await this.api.start();
  }

  public async stop(): Promise<void> {
    await this.api.stop();
    await this.sync.stop();
    await this.opPool.stop();

    await this.chain.stop();
    await this.eth1.stop();
    await this.network.stop();
    await this.db.stop();
    await this.metricsServer.stop();
    await this.metrics.stop();
  }
}

export default BeaconNode;
