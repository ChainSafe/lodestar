import worker from "node:worker_threads";
import {expose} from "@chainsafe/threads/worker";
import {createBeaconConfig, chainConfigFromJson} from "@lodestar/config";
import {getNodeLogger} from "@lodestar/logger/node";
import {
  BeaconStateTransitionMetrics,
  EpochTransitionStep,
  PubkeyIndexMap,
  StateCloneSource,
  StateHashTreeRootSource,
} from "@lodestar/state-transition";
import {LevelDbController} from "@lodestar/db";
import {RegistryMetricCreator, collectNodeJSMetrics} from "../../metrics/index.js";
import {JobFnQueue} from "../../util/queue/fnQueue.js";
import {QueueMetrics} from "../../util/queue/options.js";
import {BeaconDb} from "../../db/index.js";
import {HistoricalStateWorkerApi, HistoricalStateWorkerData} from "./types.js";
import {getHistoricalState} from "./getHistoricalState.js";

// most of this setup copied from networkCoreWorker.ts

const workerData = worker.workerData as HistoricalStateWorkerData;

// TODO: Pass options from main thread for logging
// TODO: Logging won't be visible in file loggers
const logger = getNodeLogger(workerData.loggerOpts);

logger.info("Historical state worker started");

const config = createBeaconConfig(chainConfigFromJson(workerData.chainConfigJson), workerData.genesisValidatorsRoot);

const db = new BeaconDb(config, await LevelDbController.create({name: workerData.dbLocation}, {logger}));

const abortController = new AbortController();

// Set up metrics, nodejs, state transition, queue
const metricsRegister = workerData.metricsEnabled ? new RegistryMetricCreator() : null;
let stateTransitionMetrics: BeaconStateTransitionMetrics | undefined;
let queueMetrics: QueueMetrics | undefined;
if (metricsRegister) {
  const closeMetrics = collectNodeJSMetrics(metricsRegister, "lodestar_historical_state_worker_");
  abortController.signal.addEventListener("abort", closeMetrics, {once: true});

  stateTransitionMetrics = {
    epochTransitionTime: metricsRegister.histogram({
      name: "lodestar_historical_state_stfn_epoch_transition_seconds",
      help: "Time to process a single epoch transition in seconds",
      // Epoch transitions are 100ms on very fast clients, and average 800ms on heavy networks
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1, 1.25, 1.5, 3, 10],
    }),
    epochTransitionCommitTime: metricsRegister.histogram({
      name: "lodestar_historical_state_stfn_epoch_transition_commit_seconds",
      help: "Time to call commit after process a single epoch transition in seconds",
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
    }),
    epochTransitionStepTime: metricsRegister.histogram<{step: EpochTransitionStep}>({
      name: "lodestar_historical_state_stfn_epoch_transition_step_seconds",
      help: "Time to call each step of epoch transition in seconds",
      labelNames: ["step"],
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
    }),
    processBlockTime: metricsRegister.histogram({
      name: "lodestar_historical_state_stfn_process_block_seconds",
      help: "Time to process a single block in seconds",
      // TODO: Add metrics for each step
      // Block processing can take 5-40ms, 100ms max
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 1],
    }),
    processBlockCommitTime: metricsRegister.histogram({
      name: "lodestar_historical_state_stfn_process_block_commit_seconds",
      help: "Time to call commit after process a single block in seconds",
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 1],
    }),
    stateHashTreeRootTime: metricsRegister.histogram<{source: StateHashTreeRootSource}>({
      name: "lodestar_historical_state_stfn_hash_tree_root_seconds",
      help: "Time to compute the hash tree root of a post state in seconds",
      buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5],
      labelNames: ["source"],
    }),
    preStateBalancesNodesPopulatedMiss: metricsRegister.gauge<{source: StateCloneSource}>({
      name: "lodestar_historical_state_stfn_balances_nodes_populated_miss_total",
      help: "Total count state.balances nodesPopulated is false on stfn",
      labelNames: ["source"],
    }),
    preStateBalancesNodesPopulatedHit: metricsRegister.gauge<{source: StateCloneSource}>({
      name: "lodestar_historical_state_stfn_balances_nodes_populated_hit_total",
      help: "Total count state.balances nodesPopulated is true on stfn",
      labelNames: ["source"],
    }),
    preStateValidatorsNodesPopulatedMiss: metricsRegister.gauge<{source: StateCloneSource}>({
      name: "lodestar_historical_state_stfn_validators_nodes_populated_miss_total",
      help: "Total count state.validators nodesPopulated is false on stfn",
      labelNames: ["source"],
    }),
    preStateValidatorsNodesPopulatedHit: metricsRegister.gauge<{source: StateCloneSource}>({
      name: "lodestar_historical_state_stfn_validators_nodes_populated_hit_total",
      help: "Total count state.validators nodesPopulated is true on stfn",
      labelNames: ["source"],
    }),
    preStateClonedCount: metricsRegister.histogram({
      name: "lodestar_historical_state_stfn_state_cloned_count",
      help: "Histogram of cloned count per state every time state.clone() is called",
      buckets: [1, 2, 5, 10, 50, 250],
    }),
    postStateBalancesNodesPopulatedHit: metricsRegister.gauge({
      name: "lodestar_historical_state_stfn_post_state_balances_nodes_populated_hit_total",
      help: "Total count state.validators nodesPopulated is true on stfn for post state",
    }),
    postStateBalancesNodesPopulatedMiss: metricsRegister.gauge({
      name: "lodestar_historical_state_stfn_post_state_balances_nodes_populated_miss_total",
      help: "Total count state.validators nodesPopulated is false on stfn for post state",
    }),
    postStateValidatorsNodesPopulatedHit: metricsRegister.gauge({
      name: "lodestar_historical_state_stfn_post_state_validators_nodes_populated_hit_total",
      help: "Total count state.validators nodesPopulated is true on stfn for post state",
    }),
    postStateValidatorsNodesPopulatedMiss: metricsRegister.gauge({
      name: "lodestar_historical_state_stfn_post_state_validators_nodes_populated_miss_total",
      help: "Total count state.validators nodesPopulated is false on stfn for post state",
    }),
    registerValidatorStatuses: () => {},
  };

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
  async getHistoricalState(slot) {
    return queue.push(() => getHistoricalState(slot, config, db, pubkey2index, stateTransitionMetrics));
  },
};

expose(api);
