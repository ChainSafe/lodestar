import {Gauge, Histogram} from "@lodestar/utils";
import {RegistryMetricCreator} from "../../../metrics/index.ts";

export enum DiffStateRegenErrorType {
  loadSnapshotState = "load_snapshot_state",
  loadDiffState = "load_diff_state",
  diffReplay = "diff_replay",
  blockReplay = "block_replay",
}

export type DifferentialStateRegenMetrics = {
  /**
   * Total time in seconds to regenerate a historical state via differential state
   */
  regenTime: Histogram;
  /**
   * Time in seconds to load an individual snapshot state from the database
   */
  loadSnapshotStateTime: Histogram;
  /**
   * Time in seconds to load an individual differential state from the database
   */
  loadDiffStateTime: Histogram;
  /**
   * Time in seconds to replay blocks to regenerate historical state via differential state
   */
  blockReplayTime: Histogram;
  /**
   * Count of blocks processed during state transition to differential historical state
   */
  blockReplayCount: Histogram;
  /**
   * Count of total regenerate requests via differential state
   */
  regenRequestCount: Gauge;
  /**
   * Count of successful regenerate via differential state
   */
  regenSuccessCount: Gauge;
  /**
   * Count of failed regenerate via differential state
   */
  regenErrorCount: Gauge<{reason: DiffStateRegenErrorType}>;
  /**
   * Time in seconds to compute a differential state from two states
   */
  computeDiffStateTime: Histogram;
  /**
   * Time in seconds to apply a differential state to a base state
   */
  applyDiffStateTime: Histogram;
  /**
   * Size of the state diff in bytes
   */
  stateDiffSize: Gauge;
  /**
   * Size of the state snapshot in bytes
   */
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
    loadSnapshotStateTime: metricsRegister.histogram({
      name: "lodestar_differential_state_load_snapshot_state_time_seconds",
      help: "Time to load a differential snapshot state from the database in seconds",
      // 30s, 1m, 2m, 4m
      buckets: [30, 60, 120, 240],
    }),
    loadDiffStateTime: metricsRegister.histogram({
      name: "lodestar_differential_state_load_diff_state_time_seconds",
      help: "Time to load a differential state from the database in seconds",
      // 30s, 1m, 2m, 4m
      buckets: [30, 60, 120, 240],
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
    regenErrorCount: metricsRegister.gauge<{reason: DiffStateRegenErrorType}>({
      name: "lodestar_differential_state_error_count",
      help: "Count of failed differential state regen",
      labelNames: ["reason"],
    }),
    computeDiffStateTime: metricsRegister.histogram({
      name: "lodestar_differential_state_compute_diff_state_time_seconds",
      help: "Time to compute a differential state from two states",
      // 30s, 1m, 2m, 4m
      buckets: [30, 60, 120, 240],
    }),
    applyDiffStateTime: metricsRegister.histogram({
      name: "lodestar_differential_state_apply_diff_state_time_seconds",
      help: "Time to apply a differential state to a base state",
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
