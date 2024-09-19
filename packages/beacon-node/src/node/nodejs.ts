import {setMaxListeners} from "node:events";
import {Registry} from "prom-client";

import {PrivateKey} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {phase0} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import type {LoggerNode} from "@lodestar/logger/node";
import {BeaconApiMethods} from "@lodestar/api/beacon/server";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {ProcessShutdownCallback} from "@lodestar/validator";

import {IBeaconDb} from "../db/index.js";
import {Network, getReqRespHandlers} from "../network/index.js";
import {BeaconSync, IBeaconSync} from "../sync/index.js";
import {BackfillSync} from "../sync/backfill/index.js";
import {BeaconChain, IBeaconChain, initBeaconMetrics} from "../chain/index.js";
import {createMetrics, Metrics, HttpMetricsServer, getHttpMetricsServer} from "../metrics/index.js";
import {MonitoringService} from "../monitoring/index.js";
import {getApi, BeaconRestApiServer} from "../api/index.js";
import {initializeExecutionEngine, initializeExecutionBuilder} from "../execution/index.js";
import {initializeEth1ForBlockProduction} from "../eth1/index.js";
import {initCKZG, loadEthereumTrustedSetup, TrustedFileMode} from "../util/kzg.js";
import {HistoricalStateRegen} from "../chain/historicalState/index.js";
import {IBeaconNodeOptions} from "./options.js";
import {runNodeNotifier} from "./notifier.js";

export * from "./options.js";

export type BeaconNodeModules = {
  opts: IBeaconNodeOptions;
  config: BeaconConfig;
  db: IBeaconDb;
  metrics: Metrics | null;
  network: Network;
  chain: IBeaconChain;
  api: BeaconApiMethods;
  sync: IBeaconSync;
  backfillSync: BackfillSync | null;
  metricsServer: HttpMetricsServer | null;
  monitoring: MonitoringService | null;
  restApi?: BeaconRestApiServer;
  controller?: AbortController;
};

export type BeaconNodeInitModules = {
  opts: IBeaconNodeOptions;
  config: BeaconConfig;
  db: IBeaconDb;
  logger: LoggerNode;
  processShutdownCallback: ProcessShutdownCallback;
  privateKey: PrivateKey;
  peerStoreDir?: string;
  anchorState: BeaconStateAllForks;
  wsCheckpoint?: phase0.Checkpoint;
  metricsRegistries?: Registry[];
};

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
  execution = "execution",
  metrics = "metrics",
  monitoring = "monitoring",
  network = "network",
  /** validator monitor */
  vmon = "vmon",
  rest = "rest",
  sync = "sync",
}

/**
 * Short delay before closing db to give async operations sufficient time to complete
 * and prevent "Database is not open" errors when shutting down beacon node.
 */
const DELAY_BEFORE_CLOSING_DB_MS = 500;

/**
 * The main Beacon Node class.  Contains various components for getting and processing data from the
 * Ethereum Consensus ecosystem as well as systems for getting beacon node metadata.
 */
export class BeaconNode {
  opts: IBeaconNodeOptions;
  config: BeaconConfig;
  db: IBeaconDb;
  metrics: Metrics | null;
  metricsServer: HttpMetricsServer | null;
  monitoring: MonitoringService | null;
  network: Network;
  chain: IBeaconChain;
  api: BeaconApiMethods;
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
  }: BeaconNodeModules) {
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
    privateKey,
    peerStoreDir,
    anchorState,
    wsCheckpoint,
    metricsRegistries = [],
  }: BeaconNodeInitModules): Promise<T> {
    const controller = new AbortController();
    // We set infinity to prevent MaxListenersExceededWarning which get logged when listeners > 10
    // Since it is perfectly fine to have listeners > 10
    setMaxListeners(Infinity, controller.signal);
    const signal = controller.signal;

    // If deneb is configured, load the trusted setup
    if (config.DENEB_FORK_EPOCH < Infinity) {
      await initCKZG();
      loadEthereumTrustedSetup(TrustedFileMode.Txt, opts.chain.trustedSetup);
    }

    // Prune hot db repos
    // TODO: Should this call be awaited?
    await db.pruneHotDb();

    let metrics = null;
    if (
      opts.metrics.enabled ||
      // monitoring relies on metrics data
      opts.monitoring.endpoint
    ) {
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
      signal.addEventListener("abort", metrics.close, {once: true});
    }

    const monitoring = opts.monitoring.endpoint
      ? new MonitoringService(
          "beacon",
          {...opts.monitoring, endpoint: opts.monitoring.endpoint},
          {register: (metrics as Metrics).register, logger: logger.child({module: LoggerModule.monitoring})}
        )
      : null;

    const historicalStateRegen = await HistoricalStateRegen.init({
      opts: {
        genesisTime: anchorState.genesisTime,
        dbLocation: opts.db.name,
      },
      config,
      metrics,
      logger: logger.child({module: LoggerModule.chain}),
      signal,
    });

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
      executionEngine: initializeExecutionEngine(opts.executionEngine, {
        metrics,
        signal,
        logger: logger.child({module: LoggerModule.execution}),
      }),
      executionBuilder: opts.executionBuilder.enabled
        ? initializeExecutionBuilder(opts.executionBuilder, config, metrics, logger)
        : undefined,
      historicalStateRegen,
    });

    // Load persisted data from disk to in-memory caches
    await chain.loadFromDisk();

    // Network needs to be initialized before the sync
    // See https://github.com/ChainSafe/lodestar/issues/4543
    const network = await Network.init({
      opts: opts.network,
      config,
      logger: logger.child({module: LoggerModule.network}),
      metrics,
      chain,
      db,
      privateKey,
      peerStoreDir,
      getReqRespHandler: getReqRespHandlers({db, chain}),
    });

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

    // only start server if metrics are explicitly enabled
    const metricsServer = opts.metrics.enabled
      ? await getHttpMetricsServer(opts.metrics, {
          register: (metrics as Metrics).register,
          getOtherMetrics: async () => Promise.all([network.scrapeMetrics(), historicalStateRegen.scrapeMetrics()]),
          logger: logger.child({module: LoggerModule.metrics}),
        })
      : null;

    const restApi = new BeaconRestApiServer(opts.api.rest, {
      config,
      logger: logger.child({module: LoggerModule.rest}),
      api,
      metrics: metrics ? metrics.apiRest : null,
    });
    if (opts.api.rest.enabled) {
      await restApi.registerRoutes(opts.api.version);
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
      if (this.restApi) await this.restApi.close();
      await this.network.close();
      if (this.metricsServer) await this.metricsServer.close();
      if (this.monitoring) this.monitoring.close();
      await this.chain.persistToDisk();
      await this.chain.close();
      if (this.controller) this.controller.abort();
      await sleep(DELAY_BEFORE_CLOSING_DB_MS);
      await this.db.close();
      this.status = BeaconNodeStatus.closed;
    }
  }
}
