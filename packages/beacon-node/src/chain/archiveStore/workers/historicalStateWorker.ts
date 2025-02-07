import worker from "node:worker_threads";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {Transfer, expose} from "@chainsafe/threads/worker";
import {chainConfigFromJson, createBeaconConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db";
import {getNodeLogger} from "@lodestar/logger/node";
import {BeaconDb} from "../../../db/index.js";
import {RegistryMetricCreator, collectNodeJSMetrics} from "../../../metrics/index.js";
import {JobFnQueue} from "../../../util/queue/fnQueue.js";
import {QueueMetrics} from "../../../util/queue/options.js";
import {HistoricalStateApi, HistoricalStateWorkerData} from "../interface.js";
import {HistoricalStateMetrics, getHistoricalStateMetrics, getQueueMetrics} from "../metrics.js";
import {getHistoricalState} from "../utils/getHistoricalState.js";

// most of this setup copied from networkCoreWorker.ts

const workerData = worker.workerData as HistoricalStateWorkerData;

// TODO: Pass options from main thread for logging
// TODO: Logging won't be visible in file loggers
const logger = getNodeLogger(workerData.loggerOpts);

logger.info("Historical state worker started");

const config = createBeaconConfig(chainConfigFromJson(workerData.chainConfigJson), workerData.genesisValidatorsRoot);

const db = new BeaconDb(config, await LevelDbController.create({name: workerData.archiveDbPath}, {logger}));

const abortController = new AbortController();

// Set up metrics, nodejs, state transition, queue
const metricsRegister = workerData.metricsEnabled ? new RegistryMetricCreator() : null;
let historicalStateRegenMetrics: HistoricalStateMetrics | undefined;
let queueMetrics: QueueMetrics | undefined;
if (metricsRegister) {
  const closeMetrics = collectNodeJSMetrics(metricsRegister, "lodestar_historical_state_worker_");
  abortController.signal.addEventListener("abort", closeMetrics, {once: true});

  historicalStateRegenMetrics = getHistoricalStateMetrics(metricsRegister);
  queueMetrics = getQueueMetrics(metricsRegister);
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

const api: HistoricalStateApi = {
  async close() {
    abortController.abort();
  },
  async scrapeMetrics() {
    return metricsRegister?.metrics() ?? "";
  },
  async getHistoricalState(slot) {
    historicalStateRegenMetrics?.regenRequestCount.inc();

    const stateBytes = await queue.push<Uint8Array>(() =>
      getHistoricalState(slot, config, db, pubkey2index, historicalStateRegenMetrics)
    );
    const result = Transfer(stateBytes, [stateBytes.buffer]) as unknown as Uint8Array;

    historicalStateRegenMetrics?.regenSuccessCount.inc();
    return result;
  },
};

expose(api);
