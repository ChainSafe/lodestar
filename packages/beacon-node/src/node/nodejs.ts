import {setMaxListeners} from "node:events";
import {Registry} from "prom-client";

import {IBeaconConfig} from "@lodestar/config";
import {phase0} from "@lodestar/types";
import {ILogger} from "@lodestar/utils";
import {Api, ServerApi} from "@lodestar/api";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {ProcessShutdownCallback} from "@lodestar/validator";

import {IBeaconDb} from "../db/index.js";
import {Libp2p, INetwork, Network, getReqRespHandlers} from "../network/index.js";
import {BeaconSync, IBeaconSync} from "../sync/index.js";
import {BackfillSync} from "../sync/backfill/index.js";
import {BeaconChain, IBeaconChain, initBeaconMetrics} from "../chain/index.js";
import {createMetrics, IMetrics, HttpMetricsServer} from "../metrics/index.js";
import {MonitoringService} from "../monitoring/index.js";
import {getApi, BeaconRestApiServer} from "../api/index.js";
import {initializeExecutionEngine, initializeExecutionBuilder} from "../execution/index.js";
import {initializeEth1ForBlockProduction} from "../eth1/index.js";
import {initCKZG, loadEthereumTrustedSetup} from "../util/kzg.js";
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
  api: {[K in keyof Api]: ServerApi<Api[K]>};
  sync: IBeaconSync;
  backfillSync: BackfillSync | null;
  metricsServer?: HttpMetricsServer;
  monitoring: MonitoringService | null;
  restApi?: BeaconRestApiServer;
  controller?: AbortController;
}

export interface IBeaconNodeInitModules {
  opts: IBeaconNodeOptions;
  config: IBeaconConfig;
  db: IBeaconDb;
  logger: ILogger;
  processShutdownCallback: ProcessShutdownCallback;
  libp2p: Libp2p;
  anchorState: BeaconStateAllForks;
  wsCheckpoint?: phase0.Checkpoint;
  metricsRegistries?: Registry[];
}

export enum BeaconNodeStatus {
  started = "started",
  closing = "closing",
  closed = "closed",
}

enum LoggerModule {
  api = "api",
  backfill = "backfill",
  chain = "chain",
  eth1 = "eth1",
  metrics = "metrics",
  monitoring = "monitoring",
  network = "network",
  /** validator monitor */
  vmon = "vmon",
  rest = "rest",
  sync = "sync",
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
  monitoring: MonitoringService | null;
  network: INetwork;
  chain: IBeaconChain;
  api: {[K in keyof Api]: ServerApi<Api[K]>};
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
    monitoring,
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
    this.monitoring = monitoring;
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
    processShutdownCallback,
    libp2p,
    anchorState,
    wsCheckpoint,
    metricsRegistries = [],
  }: IBeaconNodeInitModules): Promise<T> {
    const controller = new AbortController();
    // We set infinity to prevent MaxListenersExceededWarning which get logged when listeners > 10
    // Since it is perfectly fine to have listeners > 10
    setMaxListeners(Infinity, controller.signal);
    const signal = controller.signal;

    // TODO EIP-4844, where is the best place to do this?
    if (config.EIP4844_FORK_EPOCH < Infinity) {
      // TODO EIP-4844: "c-kzg" is not installed by default, so if the library is not installed this will throw
      // See "Not able to build lodestar from source" https://github.com/ChainSafe/lodestar/issues/4886
      await initCKZG();
      loadEthereumTrustedSetup();
    }

    // start db if not already started
    await db.start();
    // Prune hot db repos
    // TODO: Should this call be awaited?
    await db.pruneHotDb();

    let metrics = null;
    if (opts.metrics.enabled) {
      metrics = createMetrics(
        opts.metrics,
        config,
        anchorState,
        logger.child({module: LoggerModule.vmon}),
        metricsRegistries
      );
      initBeaconMetrics(metrics, anchorState);
      // Since the db is instantiated before this, metrics must be injected manually afterwards
      db.setMetrics(metrics.db);
    }

    let monitoring = null;
    if (opts.monitoring.endpoint) {
      if (metrics == null) {
        throw new Error("Metrics must be enabled to use monitoring");
      }
      monitoring = new MonitoringService("beacon", opts.monitoring, {
        register: metrics.register,
        logger: logger.child({module: LoggerModule.monitoring}),
      });
      monitoring.start();
    }

    const chain = new BeaconChain(opts.chain, {
      config,
      db,
      logger: logger.child({module: LoggerModule.chain}),
      processShutdownCallback,
      metrics,
      anchorState,
      eth1: initializeEth1ForBlockProduction(opts.eth1, {
        config,
        db,
        metrics,
        logger: logger.child({module: LoggerModule.eth1}),
        signal,
      }),
      executionEngine: initializeExecutionEngine(opts.executionEngine, {metrics, signal}),
      executionBuilder: opts.executionBuilder.enabled
        ? initializeExecutionBuilder(opts.executionBuilder, config)
        : undefined,
    });

    // Load persisted data from disk to in-memory caches
    await chain.loadFromDisk();

    const network = new Network(opts.network, {
      config,
      libp2p,
      logger: logger.child({module: LoggerModule.network}),
      metrics,
      chain,
      reqRespHandlers: getReqRespHandlers({db, chain}),
      signal,
    });

    // Network needs to start before the sync
    // See https://github.com/ChainSafe/lodestar/issues/4543
    await network.start();

    const sync = new BeaconSync(opts.sync, {
      config,
      db,
      chain,
      metrics,
      network,
      wsCheckpoint,
      logger: logger.child({module: LoggerModule.sync}),
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
            logger: logger.child({module: LoggerModule.backfill}),
            signal,
          })
        : null;

    const api = getApi(opts.api, {
      config,
      logger: logger.child({module: LoggerModule.api}),
      db,
      sync,
      network,
      chain,
      metrics,
    });

    const metricsServer = metrics
      ? new HttpMetricsServer(opts.metrics, {
          register: metrics.register,
          getOtherMetrics: async (): Promise<string> => {
            return (await network.discv5()?.metrics()) ?? "";
          },
          logger: logger.child({module: LoggerModule.metrics}),
        })
      : undefined;
    if (metricsServer) {
      await metricsServer.start();
    }

    const restApi = new BeaconRestApiServer(opts.api.rest, {
      config,
      logger: logger.child({module: LoggerModule.rest}),
      api,
      metrics: metrics ? metrics.apiRest : null,
    });
    if (opts.api.rest.enabled) {
      await restApi.listen();
    }

    void runNodeNotifier({network, chain, sync, config, logger, signal});

    return new this({
      opts,
      config,
      db,
      metrics,
      metricsServer,
      monitoring,
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
      if (this.monitoring) this.monitoring.stop();
      if (this.restApi) await this.restApi.close();

      await this.chain.persistToDisk();
      await this.chain.close();
      await this.db.stop();
      if (this.controller) this.controller.abort();
      this.status = BeaconNodeStatus.closed;
    }
  }
}
