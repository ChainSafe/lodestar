/**
 * @module node
 */

import deepmerge from "deepmerge";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconDb, LevelDbController} from "../db";
import defaultConf, {IBeaconNodeOptions} from "./options";
import {EthersEth1Notifier, IEth1Notifier} from "../eth1";
import {INetwork, Libp2pNetwork} from "../network";
import LibP2p from "libp2p";
import {isPlainObject} from "@chainsafe/lodestar-utils";
import {Sync} from "../sync";
import {BeaconChain, IBeaconChain} from "../chain";
import {OpPool} from "../opPool";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";
import {BeaconMetrics, HttpMetricsServer} from "../metrics";
import {ApiService} from "../api";
import {ReputationStore} from "../sync/IReputation";
import {GossipMessageValidator} from "../network/gossip/validator";
import {TasksService} from "../tasks";
import {initBLS} from "@chainsafe/bls";

export interface IService {
  start(): Promise<void>;

  stop(): Promise<void>;
}

interface IBeaconNodeModules {
  config: IBeaconConfig;
  logger: ILogger;
  eth1?: IEth1Notifier;
  libp2p?: LibP2p;
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
  public api: IService;
  public sync: Sync;
  public reps: ReputationStore;
  public chores: TasksService;

  private logger: ILogger;

  public constructor(opts: Partial<IBeaconNodeOptions>, {config, logger, eth1, libp2p}: IBeaconNodeModules) {
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
    this.metrics = new BeaconMetrics(this.conf.metrics, {
      logger: logger.child(this.conf.logger.metrics),
    });
    this.metricsServer = new HttpMetricsServer(this.conf.metrics, {
      metrics: this.metrics,
      logger: logger.child(this.conf.logger.metrics)
    });
    this.reps = new ReputationStore();
    this.db = new BeaconDb({
      config,
      controller: new LevelDbController(this.conf.db, {
        logger: logger.child(this.conf.logger.db),
      }),
    });
    this.eth1 = eth1 || new EthersEth1Notifier(this.conf.eth1, {
      config,
      logger: logger.child(this.conf.logger.eth1),
    });
    this.opPool = new OpPool(this.conf.opPool, {
      config,
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

    const gossipMessageValidator = new GossipMessageValidator({
      chain: this.chain,
      db: this.db,
      config,
      logger: logger.child(this.conf.logger.network)
    });
    this.network = new Libp2pNetwork(this.conf.network, {
      config,
      libp2p,
      logger: logger.child(this.conf.logger.network),
      metrics: this.metrics,
      validator: gossipMessageValidator,
    });
    this.sync = new Sync(this.conf.sync, {
      config,
      db: this.db,
      eth1: this.eth1,
      chain: this.chain,
      opPool: this.opPool,
      network: this.network,
      reps: this.reps,
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
        network: this.network,
        chain: this.chain,
        eth1: this.eth1
      }
    );
    this.chores = new TasksService(
      this.config,
      {
        db: this.db,
        chain: this.chain,
        sync: this.sync,
        network: this.network,
        logger: this.logger.child(this.conf.logger.chores)
      }
    );

  }

  public async start(): Promise<void> {
    this.logger.info("Starting eth2 beacon node - LODESTAR!");
    //if this wasm inits starts piling up, we can extract them to separate methods
    await initBLS();
    await this.metrics.start();
    await this.metricsServer.start();
    await this.db.start();
    await this.network.start();
    await this.eth1.start();
    await this.chain.start();
    await this.opPool.start();
    this.sync.start();
    await this.api.start();
    await this.chores.start();
  }

  public async stop(): Promise<void> {
    await this.chores.stop();
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
