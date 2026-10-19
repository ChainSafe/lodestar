import {setMaxListeners} from "node:events";
import {PrivateKey} from "@libp2p/interface";
import {Registry} from "prom-client";
import {type PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {hasher} from "@chainsafe/persistent-merkle-tree";
import {BeaconApiMethods} from "@lodestar/api/beacon/server";
import {BeaconConfig} from "@lodestar/config";
import type {LoggerNode} from "@lodestar/logger/node";
import {ZERO_HASH_HEX} from "@lodestar/params";
import {readBeaconStateBytesMetadata} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {LodestarError, sleep} from "@lodestar/utils";
import {ProcessShutdownCallback} from "@lodestar/validator";
import {BeaconRestApiServer, getApi} from "../api/index.js";
import {BeaconEngine, BeaconEngineCore} from "../chain/beaconEngine/index.js";
import {AnchorSummary} from "../chain/beaconEngine/initialization.js";
import {IBeaconEngine} from "../chain/beaconEngine/interface.js";
import {BlockSerializedCache} from "../chain/blocks/blockSerializedCache.js";
import {ChainEventEmitter} from "../chain/emitter.js";
import {BeaconChain, IBeaconChain} from "../chain/index.js";
import {initBeaconMetrics} from "../chain/initState.js";
import {DbCPStateDatastore} from "../chain/stateCache/datastore/db.js";
import {FileCPStateDatastore} from "../chain/stateCache/datastore/file.js";
import {StateInitialization} from "../chain/stateInitialization.js";
import {IBeaconDb} from "../db/index.js";
import {initializeExecutionEngine} from "../execution/index.js";
import {HttpMetricsServer, Metrics, createMetrics, getHttpMetricsServer} from "../metrics/index.js";
import {MonitoringService} from "../monitoring/index.js";
import {Network, getReqRespHandlers} from "../network/index.js";
import {computeNodeIdFromPrivateKey} from "../network/subnets/interface.js";
import {BeaconSync, IBeaconSync} from "../sync/index.js";
import {Clock} from "../util/clock.js";
import {CustodyConfig} from "../util/dataColumns.js";
import {SerializedCache} from "../util/serializedCache.js";
import {startDeferredVoluntaryExitPublisher} from "./deferredVoluntaryExitPublisher.js";
import {runNodeNotifier} from "./notifier.js";
import {IBeaconNodeOptions} from "./options.js";
import {getAnchorExecutionBlockHash} from "./utils/anchorState.js";

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
  metricsServer: HttpMetricsServer | null;
  monitoring: MonitoringService | null;
  restApi?: BeaconRestApiServer;
  controller?: AbortController;
};

export type BeaconNodeInitModules = {
  opts: IBeaconNodeOptions;
  pubkeyCache: PubkeyCache;
  db: IBeaconDb;
  logger: LoggerNode;
  processShutdownCallback: ProcessShutdownCallback;
  privateKey: PrivateKey;
  dataDir: string;
  dataColumnDir: string;
  peerStoreDir?: string;
  stateInitialization: StateInitialization;
  metricsRegistries?: Registry[];
};

export enum BeaconNodeStatus {
  started = "started",
  closing = "closing",
  closed = "closed",
}

enum LoggerModule {
  api = "api",
  chain = "chain",
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
    this.controller = controller;

    this.status = BeaconNodeStatus.started;
  }

  /**
   * Initialize a beacon node.  Initializes and `start`s the varied sub-component services of the
   * beacon node
   */
  static async init<T extends BeaconNode = BeaconNode>({
    opts,
    pubkeyCache,
    db,
    logger,
    processShutdownCallback,
    privateKey,
    dataDir,
    dataColumnDir,
    peerStoreDir,
    stateInitialization,
    metricsRegistries = [],
  }: BeaconNodeInitModules): Promise<T> {
    const {config} = stateInitialization;
    const metadata = readBeaconStateBytesMetadata(stateInitialization.stateBytes);
    if (!metadata) throw new LodestarError({code: "ANCHOR_STATE_BYTES_INVALID"});
    if (hasher.name !== "hashtree") {
      logger.warn(`hashtree is not supported, using hasher ${hasher.name}`);
    }

    const controller = new AbortController();
    // We set infinity to prevent MaxListenersExceededWarning which get logged when listeners > 10
    // Since it is perfectly fine to have listeners > 10
    setMaxListeners(Infinity, controller.signal);
    const signal = controller.signal;

    let metrics = null;
    if (
      opts.metrics.enabled ||
      // monitoring relies on metrics data
      opts.monitoring.endpoint
    ) {
      metrics = createMetrics(opts.metrics, metadata.genesisTime, metricsRegistries);
      // Since the db is instantiated before this, metrics must be injected manually afterwards
      db.setMetrics(metrics.db, metrics.flatFileStore);
      signal.addEventListener("abort", metrics.close, {once: true});
    }

    const clock = new Clock({config, genesisTime: metadata.genesisTime, signal});

    await db.init();

    const monitoring = opts.monitoring.endpoint
      ? new MonitoringService(
          "beacon",
          {...opts.monitoring, endpoint: opts.monitoring.endpoint},
          {register: (metrics as Metrics).register, logger: logger.child({module: LoggerModule.monitoring})}
        )
      : null;

    let executionEngineOpts = opts.executionEngine;
    if (opts.executionEngine.mode === "mock") {
      const latestEth1BlockHash = getAnchorExecutionBlockHash(config, stateInitialization.stateBytes, metadata.slot);
      executionEngineOpts = {
        ...opts.executionEngine,
        genesisBlockHash: ZERO_HASH_HEX,
        eth1BlockHash: opts.executionEngine.eth1BlockHash ?? latestEth1BlockHash,
        genesisTime: metadata.genesisTime,
        config,
      };
    }

    const chainLogger = logger.child({module: LoggerModule.chain});
    const emitter = new ChainEventEmitter();
    const fileDataStore = opts.chain.nHistoricalStatesFileDataStore ?? true;
    // checkpointState is an engine repo; build the datastore from the bootstrap `db` (union) param.
    const cpStateDatastore = fileDataStore ? new FileCPStateDatastore(dataDir) : new DbCPStateDatastore(db);

    const nodeId = computeNodeIdFromPrivateKey(privateKey);
    const initialCustodyGroupCount = opts.chain.initialCustodyGroupCount ?? config.CUSTODY_REQUIREMENT;
    metrics?.peerDas.custodyGroupCount.set(initialCustodyGroupCount);
    // TODO: backfill not implemented yet
    metrics?.peerDas.custodyGroupsBackfilled.set(0);
    const custodyConfig = new CustodyConfig({
      nodeId,
      config,
      initialCustodyGroupCount,
    });

    // TODO - beacon engine: share mock backend state across worker and main-thread clients.
    // Separate mock backends prevent BeaconChain's getPayloadBodiesByHashV2 from seeing engine-imported payloads.
    const executionEngine = initializeExecutionEngine(executionEngineOpts, {
      metrics,
      signal,
      logger: logger.child({module: LoggerModule.execution}),
    });
    const builderApiClientOpts = {
      timeout: opts.executionBuilder.timeout,
      userAgent: opts.executionBuilder.userAgent,
    };
    const serializedCache = new SerializedCache({cacheDeserialized: !opts.chain.beaconEngineWorker});
    const blockSerializedCache = new BlockSerializedCache(config, {
      owner: opts.chain.beaconEngineWorker ? "chain" : "shared",
      metrics: metrics?.blockSerializedCache,
      logger: chainLogger,
    });
    const beaconEngineCore = new BeaconEngineCore({
      serializedCache: opts.chain.beaconEngineWorker ? undefined : serializedCache,
      blockSerializedCache: opts.chain.beaconEngineWorker ? undefined : blockSerializedCache,
      validatorMonitorLogger: logger.child({module: LoggerModule.vmon}),
      validatorMonitorOpts:
        opts.metrics.enabled || opts.validatorMonitor.validatorMonitorLogs ? opts.validatorMonitor : null,
      isAnchorStateFinalized: stateInitialization.isFinalized,
      opts: opts.chain,
      config,
      pubkeyCache,
      db,
      dbName: opts.db.name,
      dataColumnDir,
      logger: chainLogger,
      metricsEnabled: metrics !== null,
      genesisTime: metadata.genesisTime,
      clock: opts.chain.beaconEngineWorker ? undefined : clock,
      cpStateDatastore,
      executionEngine: opts.chain.beaconEngineWorker ? undefined : executionEngine,
      executionEngineOpts,
      executionEngineLogger: logger.child({module: LoggerModule.execution}),
      executionBuilderOpts: opts.executionBuilder,
      builderApiClientOpts,
    });
    const beaconEngine = new BeaconEngine({core: beaconEngineCore, emitter, clock});
    const {earliestAvailableSlot} = await executeStateInitialization(
      beaconEngine,
      stateInitialization,
      opts.chain.nativeStateTransition ?? false
    );
    await db.pruneHotDb();
    const anchor = await beaconEngine.initializeFromAnchor();
    if (metrics) initBeaconMetrics(metrics, anchor);

    // Delete deprecated eth1 data to free up disk space for users
    logger.debug("Deleting deprecated eth1 data from database");
    const startTime = Date.now();
    db.deleteDeprecatedEth1Data()
      .then(() => {
        logger.debug("Deleted deprecated eth1 data", {durationMs: Date.now() - startTime});
      })
      .catch((e) => {
        logger.error("Failed to delete deprecated eth1 data", {}, e);
      });

    const chain = new BeaconChain(opts.chain, {
      serializedCache,
      blockSerializedCache,
      config,
      pubkeyCache,
      db,
      dbName: opts.db.name,
      dataDir,
      dataColumnDir,
      logger: chainLogger,
      processShutdownCallback,
      metrics,
      executionEngine,
      beaconEngine,
      clock,
      emitter,
      cpStateDatastore,
      custodyConfig,
      anchor,
      earliestAvailableSlot,
      // Share the engine client and its metrics in-process. Worker mode needs a facade-local client,
      // with its own HTTP state, BLS verifier and metrics; only authenticated URL registrations cross owners.
      builderApiClient: opts.chain.beaconEngineWorker ? undefined : beaconEngineCore.builderApiClient,
      builderApiClientOpts,
    });

    // Load persisted data from disk to in-memory caches
    await chain.init();

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
      logger: logger.child({module: LoggerModule.sync}),
    });

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
          getOtherMetrics: () => Promise.all([network.scrapeMetrics(), chain.beaconEngine.scrapeMetrics()]),
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

    startDeferredVoluntaryExitPublisher({chain, network, logger, signal});

    return new BeaconNode({
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
      if (this.restApi) await this.restApi.close();
      await this.network.close();
      if (this.metricsServer) await this.metricsServer.close();
      if (this.monitoring) await this.monitoring.close();
      await this.chain.persistToDisk();
      await this.chain.close();
      // Abort signal last: close() calls above clear intervals/timeouts so no new
      // operations get scheduled. If we aborted first, a still-pending interval could
      // fire and schedule a new operation after abort, leaving it stuck and delaying shutdown.
      if (this.controller) this.controller.abort();
      await sleep(DELAY_BEFORE_CLOSING_DB_MS);
      await this.db.close();
      this.status = BeaconNodeStatus.closed;
    }
  }
}

export async function executeStateInitialization(
  beaconEngine: IBeaconEngine,
  stateInitialization: StateInitialization,
  nativeStateTransition = false
): Promise<AnchorSummary & {earliestAvailableSlot: Slot}> {
  const anchor = await beaconEngine.prepareAnchorState(stateInitialization.stateBytes);
  stateInitialization.validate(anchor);
  const earliestAvailableSlot = await stateInitialization.initializeEarliestAvailableSlot(anchor);
  if (stateInitialization.shouldPersist) await beaconEngine.persistAnchorState();
  stateInitialization.log(anchor, nativeStateTransition);
  return {...anchor, earliestAvailableSlot};
}
