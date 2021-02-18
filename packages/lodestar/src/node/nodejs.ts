/**
 * @module node
 */

import {AbortController} from "abort-controller";
import LibP2p from "libp2p";

import {TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IBeaconDb} from "../db";
import {INetwork, Libp2pNetwork} from "../network";
import {BeaconSync, IBeaconSync} from "../sync";
import {BeaconChain, IBeaconChain, initBeaconMetrics} from "../chain";
import {BeaconMetrics, HttpMetricsServer, IBeaconMetrics} from "../metrics";
import {Api, IApi, RestApi} from "../api";
import {TasksService} from "../tasks";
import {IBeaconNodeOptions} from "./options";
import {GossipMessageValidator} from "../network/gossip/validator";
import {Eth1ForBlockProduction, Eth1ForBlockProductionDisabled, Eth1Provider} from "../eth1";
import {runNodeNotifier} from "./notifier";

export * from "./options";

export interface IService {
  start(): Promise<void>;

  stop(): Promise<void>;
}

export interface IBeaconNodeModules {
  opts: IBeaconNodeOptions;
  config: IBeaconConfig;
  db: IBeaconDb;
  metrics: IBeaconMetrics;
  network: INetwork;
  chain: IBeaconChain;
  api: IApi;
  sync: IBeaconSync;
  chores: TasksService;
  metricsServer?: HttpMetricsServer;
  restApi?: RestApi;
  controller?: AbortController;
}

export interface IBeaconNodeInitModules {
  opts: IBeaconNodeOptions;
  config: IBeaconConfig;
  db: IBeaconDb;
  logger: ILogger;
  libp2p: LibP2p;
  anchorState: TreeBacked<BeaconState>;
}

export enum BeaconNodeStatus {
  started = "started",
  closing = "closing",
  closed = "closed",
}

/**
 * The main Beacon Node class.  Contains various components for getting and processing data from the
 * eth2 ecosystem as well as systems for getting beacon node metadata.
 */
export class BeaconNode {
  public opts: IBeaconNodeOptions;
  public config: IBeaconConfig;
  public db: IBeaconDb;
  public metrics: IBeaconMetrics;
  public metricsServer?: HttpMetricsServer;
  public network: INetwork;
  public chain: IBeaconChain;
  public api: IApi;
  public restApi?: RestApi;
  public sync: IBeaconSync;
  public chores: TasksService;

  public status: BeaconNodeStatus;
  private controller?: AbortController;

  public constructor({
    opts,
    config,
    db,
    metrics,
    metricsServer,
    network,
    chain,
    api,
    restApi,
    sync,
    chores,
    controller,
  }: IBeaconNodeModules) {
    this.opts = opts;
    this.config = config;
    this.metrics = metrics;
    this.metricsServer = metricsServer;
    this.db = db;
    this.chain = chain;
    this.api = api;
    this.restApi = restApi;
    this.network = network;
    this.sync = sync;
    this.chores = chores;
    this.controller = controller;

    this.status = BeaconNodeStatus.started;
  }

  /**
   * Initialize a beacon node.  Initializes and `start`s the varied sub-component services of the
   * beacon node
   */
  public static async init<T extends BeaconNode = BeaconNode>({
    opts,
    config,
    db,
    logger,
    libp2p,
    anchorState,
  }: IBeaconNodeInitModules): Promise<T> {
    const controller = new AbortController();
    const signal = controller.signal;

    // start db if not already started
    await db.start();

    const metrics = new BeaconMetrics(opts.metrics, {logger: logger.child(opts.logger.metrics)});
    initBeaconMetrics(metrics, anchorState);

    const chain = new BeaconChain({
      opts: opts.chain,
      config,
      db,
      logger: logger.child(opts.logger.chain),
      metrics,
      anchorState,
    });

    const gossipMessageValidator = new GossipMessageValidator({
      chain,
      db,
      config,
      logger: logger.child(opts.logger.network),
    });
    const network = new Libp2pNetwork(opts.network, {
      config,
      libp2p,
      logger: logger.child(opts.logger.network),
      metrics,
      validator: gossipMessageValidator,
      chain,
    });
    const sync = new BeaconSync(opts.sync, {
      config,
      db,
      chain,
      network,
      logger: logger.child(opts.logger.sync),
    });
    const chores = new TasksService(config, {
      db,
      chain,
      sync,
      network,
      logger: logger.child(opts.logger.chores),
    });

    const api = new Api(opts.api, {
      config,
      logger: logger.child(opts.logger.api),
      db,
      eth1: opts.eth1.enabled
        ? new Eth1ForBlockProduction({
            config,
            db,
            eth1Provider: new Eth1Provider(config, opts.eth1),
            logger: logger.child(opts.logger.eth1),
            opts: opts.eth1,
            signal,
          })
        : new Eth1ForBlockProductionDisabled(),
      sync,
      network,
      chain,
    });
    const metricsServer = new HttpMetricsServer(opts.metrics, {
      metrics: metrics,
      logger: logger.child(opts.logger.metrics),
    });
    const restApi = await RestApi.init(opts.api.rest, {
      config,
      logger: logger.child(opts.logger.api),
      api,
    });

    await metrics.start();
    await metricsServer.start();
    await network.start();

    // TODO: refactor the sync module to respect the "start should resolve quickly" interface
    // Now if sync.start() is awaited it will stall the node start process
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    sync.start();
    await chores.start();

    void runNodeNotifier({network, chain, sync, config, logger, signal});

    return new this({
      opts,
      config,
      db,
      metrics,
      metricsServer,
      network,
      chain,
      api,
      restApi,
      sync,
      chores,
      controller,
    }) as T;
  }

  /**
   * Stop beacon node and its sub-components.
   */
  public async close(): Promise<void> {
    if (this.status === BeaconNodeStatus.started) {
      this.status = BeaconNodeStatus.closing;
      await this.chores.stop();
      await (this.sync as BeaconSync).stop();
      await this.network.stop();
      if (this.metricsServer) await this.metricsServer.stop();
      if (this.restApi) await this.restApi.close();

      await (this.metrics as BeaconMetrics).stop();
      await this.chain.close();
      await this.db.stop();
      if (this.controller) this.controller.abort();
      this.status = BeaconNodeStatus.closed;
    }
  }
}
