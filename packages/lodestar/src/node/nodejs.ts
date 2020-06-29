/**
 * @module node
 */

import deepmerge from "deepmerge";
import LibP2p from "libp2p";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {initBLS} from "@chainsafe/bls";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {isPlainObject} from "@chainsafe/lodestar-utils";

import {BeaconDb, LevelDbController} from "../db";
import defaultConf, {IBeaconNodeOptions} from "./options";
import {EthersEth1Notifier, IEth1Notifier} from "../eth1";
import {INetwork, Libp2pNetwork} from "../network";
import {BeaconSync, IBeaconSync} from "../sync";
import {BeaconChain, IBeaconChain} from "../chain";
import {BeaconMetrics, HttpMetricsServer} from "../metrics";
import {ApiService} from "../api";
import {ReputationStore} from "../sync/IReputation";
import {GossipMessageValidator} from "../network/gossip/validator";
import {TasksService} from "../tasks";

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
  public api: IService;
  public sync: IBeaconSync;
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
      db: this.db,
      logger: logger.child(this.conf.logger.eth1),
    });
    this.chain = new BeaconChain(this.conf.chain, {
      config,
      db: this.db,
      eth1: this.eth1,
      logger: logger.child(this.conf.logger.chain),
      metrics: this.metrics,
    });

    const gossipMessageValidator = new GossipMessageValidator({
      chain: this.chain,
      db: this.db,
      config,
      logger: logger.child(this.conf.logger.network)
    });
    this.network = new Libp2pNetwork(this.conf.network, this.reps, {
      config,
      libp2p,
      logger: logger.child(this.conf.logger.network),
      metrics: this.metrics,
      validator: gossipMessageValidator,
      chain: this.chain,
    });
    this.sync = new BeaconSync(this.conf.sync, {
      config,
      db: this.db,
      chain: this.chain,
      network: this.network,
      reputationStore: this.reps,
      logger: logger.child(this.conf.logger.sync),
    });
    this.api = new ApiService(
      this.conf.api,
      {
        config,
        logger: this.logger.child(this.conf.logger.api),
        db: this.db,
        sync: this.sync,
        network: this.network,
        chain: this.chain,
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
    // eth1 is started in chain
    await this.chain.start();
    await this.network.start();
    this.sync.start();
    await this.api.start();
    await this.chores.start();
  }

  public async stop(): Promise<void> {
    await this.chores.stop();
    await this.api.stop();
    await this.sync.stop();
    await this.chain.stop();
    await this.eth1.stop();
    await this.network.stop();
    await this.db.stop();
    await this.metricsServer.stop();
    await this.metrics.stop();
  }
}

export default BeaconNode;
