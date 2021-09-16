/**
 * @module node
 */

import {AbortController} from "@chainsafe/abort-controller";
import LibP2p from "libp2p";

import {TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Api} from "@chainsafe/lodestar-api";

import {IBeaconDb} from "../db";
import {INetwork, Network, getReqRespHandlers} from "../network";
import {BeaconSync, IBeaconSync} from "../sync";
import {BeaconChain, IBeaconChain, initBeaconMetrics, initializeTransitionStore} from "../chain";
import {createMetrics, IMetrics, HttpMetricsServer} from "../metrics";
import {getApi, RestApi} from "../api";
import {IBeaconNodeOptions} from "./options";
import {initializeEth1ForBlockProduction} from "../eth1";
import {runNodeNotifier} from "./notifier";
import {Registry} from "prom-client";
import {ExecutionEngineDisabled} from "../executionEngine";

export * from "./options";

export interface IBeaconNodeModules {
  opts: IBeaconNodeOptions;
  config: IBeaconConfig;
  db: IBeaconDb;
  metrics: IMetrics | null;
  network: INetwork;
  chain: IBeaconChain;
  api: Api;
  sync: IBeaconSync;
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
  anchorState: TreeBacked<allForks.BeaconState>;
  metricsRegistries?: Registry[];
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
  opts: IBeaconNodeOptions;
  config: IBeaconConfig;
  db: IBeaconDb;
  metrics: IMetrics | null;
  metricsServer?: HttpMetricsServer;
  network: INetwork;
  chain: IBeaconChain;
  api: Api;
  restApi?: RestApi;
  sync: IBeaconSync;

  status: BeaconNodeStatus;
  private controller?: AbortController;

  constructor({
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
    this.controller = controller;

    this.status = BeaconNodeStatus.started;
  }

  /**
   * Initialize a beacon node.  Initializes and `start`s the varied sub-component services of the
   * beacon node
   */
  static async init<T extends BeaconNode = BeaconNode>({
    opts,
    config,
    db,
    logger,
    libp2p,
    anchorState,
    metricsRegistries = [],
  }: IBeaconNodeInitModules): Promise<T> {
    const controller = new AbortController();
    const signal = controller.signal;

    // start db if not already started
    await db.start();

    const metrics = opts.metrics.enabled ? createMetrics(opts.metrics, config, anchorState, metricsRegistries) : null;
    if (metrics) {
      initBeaconMetrics(metrics, anchorState);
    }

    const transitionStore = await initializeTransitionStore(opts.chain, db);
    const chain = new BeaconChain(opts.chain, {
      config,
      db,
      logger: logger.child(opts.logger.chain),
      metrics,
      anchorState,
      transitionStore,
      eth1: initializeEth1ForBlockProduction(
        opts.eth1,
        {config, db, logger: logger.child(opts.logger.eth1), signal, transitionStore},
        anchorState
      ),
      executionEngine: new ExecutionEngineDisabled(),
    });

    // Load persisted data from disk to in-memory caches
    await chain.loadFromDisk();

    const network = new Network(opts.network, {
      config,
      libp2p,
      logger: logger.child(opts.logger.network),
      metrics,
      chain,
      reqRespHandlers: getReqRespHandlers({db, chain}),
      signal,
    });
    const sync = new BeaconSync(opts.sync, {
      config,
      db,
      chain,
      metrics,
      network,
      logger: logger.child(opts.logger.sync),
    });

    const api = getApi(opts.api, {
      config,
      logger: logger.child(opts.logger.api),
      db,
      sync,
      network,
      chain,
      metrics,
    });

    const metricsServer = metrics
      ? new HttpMetricsServer(opts.metrics, {metrics, logger: logger.child(opts.logger.metrics)})
      : undefined;
    if (metricsServer) {
      await metricsServer.start();
    }

    const restApi = new RestApi(opts.api.rest, {
      config,
      logger: logger.child(opts.logger.api),
      api,
      metrics,
    });
    if (opts.api.rest.enabled) {
      await restApi.listen();
    }

    await network.start();

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
      controller,
    }) as T;
  }

  /**
   * Stop beacon node and its sub-components.
   */
  async close(): Promise<void> {
    if (this.status === BeaconNodeStatus.started) {
      this.status = BeaconNodeStatus.closing;
      this.sync.close();
      await this.network.stop();
      if (this.metricsServer) await this.metricsServer.stop();
      if (this.restApi) await this.restApi.close();

      await this.chain.persistToDisk();
      this.chain.close();
      await this.db.stop();
      if (this.controller) this.controller.abort();
      this.status = BeaconNodeStatus.closed;
    }
  }
}
