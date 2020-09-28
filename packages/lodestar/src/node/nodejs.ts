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
import {Eth1Provider, Eth1ForBlockProductionDisabled} from "../eth1";
import {INetwork, Libp2pNetwork} from "../network";
import {BeaconSync, IBeaconSync} from "../sync";
import {BeaconChain, IBeaconChain} from "../chain";
import {Eth1ForBlockProduction} from "../eth1";
import {BeaconMetrics, HttpMetricsServer} from "../metrics";
import {Api, IApi, RestApi} from "../api";
import {GossipMessageValidator} from "../network/gossip/validator";
import {TasksService} from "../tasks";
import AbortController from "abort-controller";

export interface IService {
  start(): Promise<void>;

  stop(): Promise<void>;
}

interface IBeaconNodeModules {
  config: IBeaconConfig;
  logger: ILogger;
  libp2p: LibP2p;
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
  public network: INetwork;
  public chain: IBeaconChain;
  public api?: IApi;
  public restApi?: RestApi;
  public sync: IBeaconSync;
  public chores: TasksService;

  private logger: ILogger;
  private controller: AbortController;

  public constructor(opts: Partial<IBeaconNodeOptions>, {config, logger, libp2p}: IBeaconNodeModules) {
    this.controller = new AbortController();

    this.conf = deepmerge(defaultConf, opts, {
      //clone doesn't work very vell on classes like ethers.Provider
      isMergeableObject: isPlainObject,
    });
    this.config = config;
    this.logger = logger.child(this.conf.logger.node);
    this.metrics = new BeaconMetrics(this.conf.metrics, {
      logger: this.logger.child(this.conf.logger.metrics),
    });
    this.metricsServer = new HttpMetricsServer(this.conf.metrics, {
      metrics: this.metrics,
      logger: this.logger.child(this.conf.logger.metrics),
    });
    this.db = new BeaconDb({
      config,
      controller: new LevelDbController(this.conf.db, {
        logger: this.logger.child(this.conf.logger.db),
      }),
    });
    this.chain = new BeaconChain(this.conf.chain, {
      config,
      db: this.db,
      eth1Provider: new Eth1Provider(config, this.conf.eth1),
      logger: logger.child(this.conf.logger.chain),
      metrics: this.metrics,
    });

    const gossipMessageValidator = new GossipMessageValidator({
      chain: this.chain,
      db: this.db,
      config,
      logger: this.logger.child(this.conf.logger.network),
    });
    this.network = new Libp2pNetwork(this.conf.network, {
      config,
      libp2p,
      logger: this.logger.child(this.conf.logger.network),
      metrics: this.metrics,
      validator: gossipMessageValidator,
      chain: this.chain,
    });
    this.sync = new BeaconSync(this.conf.sync, {
      config,
      db: this.db,
      chain: this.chain,
      network: this.network,
      logger: this.logger.child(this.conf.logger.sync),
    });
    this.chores = new TasksService(this.config, {
      db: this.db,
      chain: this.chain,
      sync: this.sync,
      network: this.network,
      logger: this.logger.child(this.conf.logger.chores),
    });
  }

  public async start(): Promise<void> {
    this.logger.info("Starting eth2 beacon node - LODESTAR!");

    //if this wasm inits starts piling up, we can extract them to separate methods
    await initBLS();
    await this.metrics.start();
    await this.metricsServer.start();
    await this.db.start();
    await this.chain.start();
    await this.network.start();
    // TODO: refactor the sync module to respect the "start should resolve quickly" interface
    // Now if sync.start() is awaited it will stall the node start process
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.sync.start();

    this.api = new Api(this.conf.api, {
      config: this.config,
      logger: this.logger.child(this.conf.logger.api),
      db: this.db,
      eth1: this.conf.eth1.enabled
        ? new Eth1ForBlockProduction({
            config: this.config,
            db: this.db,
            eth1Provider: new Eth1Provider(this.config, this.conf.eth1),
            logger: this.logger.child(this.conf.logger.eth1),
            opts: this.conf.eth1,
            signal: this.controller.signal,
          })
        : new Eth1ForBlockProductionDisabled(),
      sync: this.sync,
      network: this.network,
      chain: this.chain,
    });
    this.restApi = await RestApi.init(this.conf.api.rest, {
      config: this.config,
      logger: this.logger.child(this.conf.logger.api),
      api: this.api,
    });
    await this.chores.start();
  }

  public async stop(): Promise<void> {
    this.controller.abort();
    await this.chores.stop();
    if (this.restApi) await this.restApi.close();
    await this.sync.stop();
    await this.chain.stop();
    await this.network.stop();
    await this.db.stop();
    await this.metricsServer.stop();
    await this.metrics.stop();
  }
}

export default BeaconNode;
