/**
 * @module node
 */

import LibP2p from "libp2p";
import {Registry} from "prom-client";

import {IBeaconConfig} from "@lodestar/config";
import {phase0} from "@lodestar/types";
import {ILogger} from "@lodestar/utils";
import {Api} from "@lodestar/api";
import {BeaconStateAllForks} from "@lodestar/state-transition";

import {IBeaconDb} from "../db/index.js";
import {INetwork, Network, getReqRespHandlers} from "../network/index.js";
import {BeaconSync, IBeaconSync} from "../sync/index.js";
import {BackfillSync} from "../sync/backfill/index.js";
import {BeaconChain, IBeaconChain, initBeaconMetrics} from "../chain/index.js";
import {createMetrics, IMetrics, HttpMetricsServer} from "../metrics/index.js";
import {getApi, BeaconRestApiServer} from "../api/index.js";
import {initializeExecutionEngine, initializeExecutionBuilder} from "../execution/index.js";
import {initializeEth1ForBlockProduction} from "../eth1/index.js";
import {IBeaconNodeOptions} from "./options.js";
import {runNodeNotifier} from "./notifier.js";

export * from "./options.js";

export interface IBeaconNodeModules {
  opts: IBeaconNodeOptions;
  config: IBeaconConfig;
  db: IBeaconDb;
  metrics: IMetrics | null;
  network: INetwork;
  chain: IBeaconChain;
  api: Api;
  sync: IBeaconSync;
  backfillSync: BackfillSync | null;
  metricsServer?: HttpMetricsServer;
  restApi?: BeaconRestApiServer;
  controller?: AbortController;
}

export interface IBeaconNodeInitModules {
  opts: IBeaconNodeOptions;
  config: IBeaconConfig;
  db: IBeaconDb;
  logger: ILogger;
  libp2p: LibP2p;
  anchorState: BeaconStateAllForks;
  wsCheckpoint?: phase0.Checkpoint;
  metricsRegistries?: Registry[];
}

export enum BeaconNodeStatus {
  started = "started",
  closing = "closing",
  closed = "closed",
}

/**
 * The main Beacon Node class.  Contains various components for getting and processing data from the
 * Ethereum Consensus ecosystem as well as systems for getting beacon node metadata.
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
  restApi?: BeaconRestApiServer;
  sync: IBeaconSync;
  backfillSync: BackfillSync | null;

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
    backfillSync,
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
    this.backfillSync = backfillSync;
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
    wsCheckpoint,
    metricsRegistries = [],
  }: IBeaconNodeInitModules): Promise<T> {
    const controller = new AbortController();
    const signal = controller.signal;

    // start db if not already started
    await db.start();

    let metrics = null;
    if (opts.metrics.enabled) {
      metrics = createMetrics(opts.metrics, config, anchorState, logger.child({module: "VMON"}), metricsRegistries);
      initBeaconMetrics(metrics, anchorState);
      // Since the db is instantiated before this, metrics must be injected manually afterwards
      db.setMetrics(metrics.db);
    }

    const chain = new BeaconChain(opts.chain, {
      config,
      db,
      logger: logger.child(opts.logger.chain),
      metrics,
      anchorState,
      eth1: initializeEth1ForBlockProduction(
        opts.eth1,
        {config, db, metrics, logger: logger.child(opts.logger.eth1), signal},
        anchorState
      ),
      executionEngine: initializeExecutionEngine(opts.executionEngine, signal),
      executionBuilder: opts.executionBuilder.enabled
        ? initializeExecutionBuilder(opts.executionBuilder, config)
        : undefined,
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
      wsCheckpoint,
      logger: logger.child(opts.logger.sync),
    });

    const backfillSync =
      opts.sync.backfillBatchSize > 0
        ? await BackfillSync.init(opts.sync, {
            config,
            db,
            chain,
            metrics,
            network,
            wsCheckpoint,
            anchorState,
            logger: logger.child(opts.logger.backfill),
            signal,
          })
        : null;

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
      ? new HttpMetricsServer(opts.metrics, {register: metrics.register, logger: logger.child(opts.logger.metrics)})
      : undefined;
    if (metricsServer) {
      await metricsServer.start();
    }

    const restApi = new BeaconRestApiServer(opts.api.rest, {
      config,
      logger: logger.child(opts.logger.api),
      api,
      metrics: metrics ? metrics.apiRest : null,
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
      backfillSync,
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
      this.backfillSync?.close();
      await this.network.stop();
      if (this.metricsServer) await this.metricsServer.stop();
      if (this.restApi) await this.restApi.close();

      await this.chain.persistToDisk();
      await this.chain.close();
      await this.db.stop();
      if (this.controller) this.controller.abort();
      this.status = BeaconNodeStatus.closed;
    }
  }
}
