import worker from "node:worker_threads";
import {Transfer, expose} from "@chainsafe/threads/worker";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {createBeaconConfig, chainConfigFromJson} from "@lodestar/config";
import {getNodeLogger} from "@lodestar/logger/node";
import {LevelDbController} from "@lodestar/db";
import {RegistryMetricCreator, collectNodeJSMetrics} from "../../metrics/index.js";
import {JobFnQueue} from "../../util/queue/fnQueue.js";
import {QueueMetrics} from "../../util/queue/options.js";
import {BeaconDb} from "../../db/index.js";
import {HistoricalStateRegenMetrics, HistoricalStateWorkerApi, HistoricalStateWorkerData} from "./types.js";
import {getMetrics} from "./metrics.js";
import {HierarchicalLayers} from "./utils/hierarchicalLayers.js";
import {getHistoricalState} from "./operations/getHistoricalState.js";
import {putHistoricalState} from "./operations/putHistoricalState.js";

// most of this setup copied from networkCoreWorker.ts

const workerData = worker.workerData as HistoricalStateWorkerData;

// TODO: Pass options from main thread for logging
// TODO: Logging won't be visible in file loggers
const logger = getNodeLogger(workerData.loggerOpts);

logger.info("Historical state worker started");

const config = createBeaconConfig(chainConfigFromJson(workerData.chainConfigJson), workerData.genesisValidatorsRoot);
const hierarchicalLayers = HierarchicalLayers.fromString(workerData.hierarchicalLayersConfig);
const db = new BeaconDb(config, await LevelDbController.create({name: workerData.dbLocation}, {logger}));

const abortController = new AbortController();

// Set up metrics, nodejs, state transition, queue
const metricsRegister = workerData.metricsEnabled ? new RegistryMetricCreator() : null;
const metrics: HistoricalStateRegenMetrics | undefined = metricsRegister ? getMetrics(metricsRegister) : undefined;
let queueMetrics: QueueMetrics | undefined;
if (metricsRegister) {
  const closeMetrics = collectNodeJSMetrics(metricsRegister, "lodestar_historical_state_worker_");
  abortController.signal.addEventListener("abort", closeMetrics, {once: true});

  queueMetrics = {
    length: metricsRegister.gauge({
      name: "lodestar_historical_state_queue_length",
      help: "Count of total regen queue length",
    }),
    droppedJobs: metricsRegister.gauge({
      name: "lodestar_historical_state_queue_dropped_jobs_total",
      help: "Count of total regen queue dropped jobs",
    }),
    jobTime: metricsRegister.histogram({
      name: "lodestar_historical_state_queue_job_time_seconds",
      help: "Time to process regen queue job in seconds",
      buckets: [0.01, 0.1, 1, 10, 100],
    }),
    jobWaitTime: metricsRegister.histogram({
      name: "lodestar_historical_state_queue_job_wait_time_seconds",
      help: "Time from job added to the regen queue to starting in seconds",
      buckets: [0.01, 0.1, 1, 10, 100],
    }),
    concurrency: metricsRegister.gauge({
      name: "lodestar_historical_state_queue_concurrency",
      help: "Current concurrency of regen queue",
    }),
  };
}

const queue = new JobFnQueue(
  {
    maxConcurrency: workerData.maxConcurrency,
    maxLength: workerData.maxLength,
    signal: abortController.signal,
  },
  queueMetrics
);

const pubkey2index = new PubkeyIndexMap();

const api: HistoricalStateWorkerApi = {
  async close() {
    abortController.abort();
  },
  async scrapeMetrics() {
    return metricsRegister?.metrics() ?? "";
  },
  async getHistoricalState(slot, stateArchiveMode) {
    metrics?.regenRequestCount.inc();

    const stateBytes = await queue.push<Uint8Array | null>(() =>
      getHistoricalState(slot, {
        config,
        stateArchiveMode,
        db,
        pubkey2index,
        logger,
        hierarchicalLayers,
        metrics: metrics,
      })
    );

    if (stateBytes) {
      const result = Transfer(stateBytes, [stateBytes.buffer]) as unknown as Uint8Array;

      metrics?.regenSuccessCount.inc();
      return result;
    }

    return null;
  },
  async storeHistoricalState(slot, stateBytes, stateArchiveMode) {
    return putHistoricalState(slot, stateBytes, {
      db,
      config,
      logger,
      stateArchiveMode,
      hierarchicalLayers,
      metrics,
    });
  },
};

expose(api);
