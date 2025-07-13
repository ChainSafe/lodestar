import {RegistryMetricCreator} from "../../../metrics/index.js";
import {QueueMetrics} from "../../../util/queue/options.js";
import {RegenErrorType} from "./types.js";

export type HistoricalStateRegenMetrics = ReturnType<typeof createHistoricalStateRegenMetrics>;

// HistoricalStateTransitionMetrics legacy
//     // lodestar_historical_state_regen dashboard
//     // not set anywhere
//     preStateBalancesNodesPopulatedMiss: metricsRegister.gauge<{source: StateCloneSource}>({
//       name: "lodestar_historical_state_stfn_balances_nodes_populated_miss_total",
//       help: "Total count state.balances nodesPopulated is false on stfn",
//       labelNames: ["source"],
//     }),

//     // lodestar_historical_state_regen dashboard
//     // not set anywhere
//     preStateValidatorsNodesPopulatedMiss: metricsRegister.gauge<{source: StateCloneSource}>({
//       name: "lodestar_historical_state_stfn_validators_nodes_populated_miss_total",
//       help: "Total count state.validators nodesPopulated is false on stfn",
//       labelNames: ["source"],
//     }),

export function createHistoricalStateRegenMetrics(metricsRegister: RegistryMetricCreator) {
  return {
    // not on dashboard
    regenTime: metricsRegister.histogram({
      name: "lodestar_historical_state_regen_time_seconds",
      help: "Time to regenerate a historical state in seconds",
      // Historical state regen can take up to 3h as of Aug 2024
      // 5m, 10m, 30m, 1h, 3h
      buckets: [5 * 60, 10 * 60, 30 * 60, 60 * 60, 180 * 60],
    }),
    // not on dashboard
    loadStateTime: metricsRegister.histogram({
      name: "lodestar_historical_state_load_nearest_state_time_seconds",
      help: "Time to load a nearest historical state from the database in seconds",
      // 30s, 1m, 2m, 4m
      buckets: [30, 60, 120, 240],
    }),
    // not on dashboard
    stateTransitionTime: metricsRegister.histogram({
      name: "lodestar_historical_state_state_transition_time_seconds",
      help: "Time to run state transition to regen historical state in seconds",
      // 5m, 10m, 30m, 1h, 3h
      buckets: [5 * 60, 10 * 60, 30 * 60, 60 * 60, 180 * 60],
    }),
    // not on dashboard
    stateTransitionBlocks: metricsRegister.histogram({
      name: "lodestar_historical_state_state_transition_blocks",
      help: "Count of blocks processed during state transition to regen historical state",
      // given archiveStateEpochFrequency=1024, it could process up to 32768 blocks
      buckets: [10, 100, 1000, 10000, 30000],
    }),
    // not on dashboard
    stateSerializationTime: metricsRegister.histogram({
      name: "lodestar_historical_state_serialization_time_seconds",
      help: "Time to serialize a historical state in seconds",
      buckets: [0.25, 0.5, 1, 2],
    }),
    // not on dashboard
    regenRequestCount: metricsRegister.gauge({
      name: "lodestar_historical_state_request_count",
      help: "Count of total historical state requests",
    }),
    // not on dashboard
    regenSuccessCount: metricsRegister.gauge({
      name: "lodestar_historical_state_success_count",
      help: "Count of successful historical state regen",
    }),
    // not on dashboard
    regenErrorCount: metricsRegister.gauge<{reason: RegenErrorType}>({
      name: "lodestar_historical_state_error_count",
      help: "Count of failed historical state regen",
      labelNames: ["reason"],
    }),
  };
}

export function createHistoricalStateQueueMetrics(metricsRegister: RegistryMetricCreator): QueueMetrics {
  return {
    // lodestar_historical_state_regen dashboard
    length: metricsRegister.gauge({
      name: "lodestar_historical_state_queue_length",
      help: "Count of total regen queue length",
    }),
    // lodestar_historical_state_regen dashboard
    droppedJobs: metricsRegister.gauge({
      name: "lodestar_historical_state_queue_dropped_jobs_total",
      help: "Count of total regen queue dropped jobs",
    }),
    // lodestar_historical_state_regen dashboard
    jobTime: metricsRegister.histogram({
      name: "lodestar_historical_state_queue_job_time_seconds",
      help: "Time to process regen queue job in seconds",
      buckets: [0.01, 0.1, 1, 10, 100],
    }),
    // lodestar_historical_state_regen dashboard
    jobWaitTime: metricsRegister.histogram({
      name: "lodestar_historical_state_queue_job_wait_time_seconds",
      help: "Time from job added to the regen queue to starting in seconds",
      buckets: [0.01, 0.1, 1, 10, 100],
    }),
    // not on dashboard
    concurrency: metricsRegister.gauge({
      name: "lodestar_historical_state_queue_concurrency",
      help: "Current concurrency of regen queue",
    }),
  };
}
