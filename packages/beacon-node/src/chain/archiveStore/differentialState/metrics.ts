import {Gauge, Histogram} from "@lodestar/utils";
import {RegistryMetricCreator} from "../../../metrics/index.ts";
import {RegenErrorType} from "../historicalState/types.ts";

export type DifferentialStateRegenMetrics = {
  regenTime: Histogram;
  blockReplayTime: Histogram;
  blockReplayCount: Histogram;
  regenRequestCount: Gauge;
  regenSuccessCount: Gauge;
  regenErrorCount: Gauge<{reason: RegenErrorType}>;
  loadSnapshotStateTime: Histogram;
  loadDiffStateTime: Histogram;
  computeDiffStateTime: Histogram;
  applyDiffStateTime: Histogram;
  stateDiffSize: Gauge;
  stateSnapshotSize: Gauge;
};

export function createDifferentialStateRegenMetrics(
  metricsRegister: RegistryMetricCreator
): DifferentialStateRegenMetrics {
  return {
    regenTime: metricsRegister.histogram({
      name: "lodestar_differential_state_regen_time_seconds",
      help: "Time to regenerate a differential state in seconds",
      // Historical state regen can take up to 3h as of Aug 2024
      // 5m, 10m, 30m, 1h, 3h
      buckets: [5 * 60, 10 * 60, 30 * 60, 60 * 60, 180 * 60],
    }),
    blockReplayTime: metricsRegister.histogram({
      name: "lodestar_differential_state_block_replay_time_seconds",
      help: "Time to run block replay to regen differential state in seconds",
      // 5m, 10m, 30m, 1h, 3h
      buckets: [5 * 60, 10 * 60, 30 * 60, 60 * 60, 180 * 60],
    }),
    blockReplayCount: metricsRegister.histogram({
      name: "lodestar_differential_state_block_replay_count",
      help: "Count of blocks processed during state transition to differential historical state",
      // given archiveStateEpochFrequency=1024, it could process up to 32768 blocks
      buckets: [10, 100, 1000, 10000, 30000],
    }),
    regenRequestCount: metricsRegister.gauge({
      name: "lodestar_differential_state_request_count",
      help: "Count of total differential state requests",
    }),
    regenSuccessCount: metricsRegister.gauge({
      name: "lodestar_differential_state_success_count",
      help: "Count of successful differential state regen",
    }),
    regenErrorCount: metricsRegister.gauge<{reason: RegenErrorType}>({
      name: "lodestar_differential_state_error_count",
      help: "Count of failed differential state regen",
      labelNames: ["reason"],
    }),
    loadSnapshotStateTime: metricsRegister.histogram({
      name: "lodestar_differential_state_load_snapshot_state_time_seconds",
      help: "Time to load a differential snapshot state from the database in seconds",
      // 30s, 1m, 2m, 4m
      buckets: [30, 60, 120, 240],
    }),
    loadDiffStateTime: metricsRegister.histogram({
      name: "lodestar_differential_state_load_diff_state_time_seconds",
      help: "Time to load a differential snapshot state from the database in seconds",
      // 30s, 1m, 2m, 4m
      buckets: [30, 60, 120, 240],
    }),
    computeDiffStateTime: metricsRegister.histogram({
      name: "lodestar_differential_state_compute_diff_state_time_seconds",
      help: "Time to compute a differential state from two states",
      // 30s, 1m, 2m, 4m
      buckets: [30, 60, 120, 240],
    }),
    applyDiffStateTime: metricsRegister.histogram({
      name: "lodestar_differential_state_apply_diff_state_time_seconds",
      help: "Time to compute a differential state from two states",
      // 30s, 1m, 2m, 4m
      buckets: [30, 60, 120, 240],
    }),
    stateDiffSize: metricsRegister.gauge({
      name: "lodestar_differential_state_diff_size",
      help: "Size of the state diff in bytes",
    }),
    stateSnapshotSize: metricsRegister.gauge({
      name: "lodestar_differential_state_snapshot_size",
      help: "Size of the state snapshot in bytes",
    }),
  };
}
