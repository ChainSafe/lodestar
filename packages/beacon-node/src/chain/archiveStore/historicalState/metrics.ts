import {
  BeaconStateTransitionMetrics,
  EpochTransitionStep,
  ProposerRewardType,
  StateCloneSource,
  StateHashTreeRootSource,
} from "@lodestar/state-transition";
import {Gauge, Histogram} from "@lodestar/utils";
import {RegistryMetricCreator} from "../../../metrics/index.js";
import {QueueMetrics} from "../../../util/queue/options.js";
import {RegenErrorType} from "./types.js";

export type HistoricalStateTransitionMetrics = BeaconStateTransitionMetrics;

export type HistoricalStateRegenMetrics = HistoricalStateTransitionMetrics & {
  regenTime: Histogram;
  loadStateTime: Histogram;
  stateTransitionTime: Histogram;
  stateTransitionBlocks: Histogram;
  stateSerializationTime: Histogram;
  regenRequestCount: Gauge;
  regenSuccessCount: Gauge;
  regenErrorCount: Gauge<{reason: RegenErrorType}>;
};

export function createHistoricalStateTransitionMetrics(
  metricsRegister: RegistryMetricCreator
): HistoricalStateTransitionMetrics {
  return {
    // state transition metrics
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
    numEffectiveBalanceUpdates: metricsRegister.gauge({
      name: "lodestar_historical_state_stfn_num_effective_balance_updates_count",
      help: "Count of effective balance updates in epoch transition",
    }),
    validatorsInActivationQueue: metricsRegister.gauge({
      name: "lodestar_historical_state_stfn_validators_in_activation_queue",
      help: "Current number of validators in the activation queue",
    }),
    validatorsInExitQueue: metricsRegister.gauge({
      name: "lodestar_historical_state_stfn_validators_in_exit_queue",
      help: "Current number of validators in the exit queue",
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
    newSeenAttestersPerBlock: metricsRegister.gauge({
      name: "lodestar_historical_state_stfn_new_seen_attesters_per_block_total",
      help: "Count of new seen attesters in epoch transition",
    }),
    newSeenAttestersEffectiveBalancePerBlock: metricsRegister.gauge({
      name: "lodestar_historical_state_stfn_new_seen_attesters_effective_balance_per_block_total",
      help: "Total effective balance increment of new seen attesters per block",
    }),
    attestationsPerBlock: metricsRegister.gauge({
      name: "lodestar_historical_state_stfn_attestations_per_block_total",
      help: "Count of attestations per block",
    }),
    proposerRewards: metricsRegister.gauge<{type: ProposerRewardType}>({
      name: "lodestar_historical_state_stfn_proposer_rewards_total",
      help: "Proposer reward by type per block",
      labelNames: ["type"],
    }),
  };
}

export function createHistoricalStateRegenMetrics(metricsRegister: RegistryMetricCreator): HistoricalStateRegenMetrics {
  return {
    ...createHistoricalStateTransitionMetrics(metricsRegister),
    // historical state regen metrics
    regenTime: metricsRegister.histogram({
      name: "lodestar_historical_state_regen_time_seconds",
      help: "Time to regenerate a historical state in seconds",
      // Historical state regen can take up to 3h as of Aug 2024
      // 5m, 10m, 30m, 1h, 3h
      buckets: [5 * 60, 10 * 60, 30 * 60, 60 * 60, 180 * 60],
    }),
    loadStateTime: metricsRegister.histogram({
      name: "lodestar_historical_state_load_nearest_state_time_seconds",
      help: "Time to load a nearest historical state from the database in seconds",
      // 30s, 1m, 2m, 4m
      buckets: [30, 60, 120, 240],
    }),
    stateTransitionTime: metricsRegister.histogram({
      name: "lodestar_historical_state_state_transition_time_seconds",
      help: "Time to run state transition to regen historical state in seconds",
      // 5m, 10m, 30m, 1h, 3h
      buckets: [5 * 60, 10 * 60, 30 * 60, 60 * 60, 180 * 60],
    }),
    stateTransitionBlocks: metricsRegister.histogram({
      name: "lodestar_historical_state_state_transition_blocks",
      help: "Count of blocks processed during state transition to regen historical state",
      // given archiveStateEpochFrequency=1024, it could process up to 32768 blocks
      buckets: [10, 100, 1000, 10000, 30000],
    }),
    stateSerializationTime: metricsRegister.histogram({
      name: "lodestar_historical_state_serialization_time_seconds",
      help: "Time to serialize a historical state in seconds",
      buckets: [0.25, 0.5, 1, 2],
    }),
    regenRequestCount: metricsRegister.gauge({
      name: "lodestar_historical_state_request_count",
      help: "Count of total historical state requests",
    }),
    regenSuccessCount: metricsRegister.gauge({
      name: "lodestar_historical_state_success_count",
      help: "Count of successful historical state regen",
    }),
    regenErrorCount: metricsRegister.gauge<{reason: RegenErrorType}>({
      name: "lodestar_historical_state_error_count",
      help: "Count of failed historical state regen",
      labelNames: ["reason"],
    }),
  };
}

export function createHistoricalStateQueueMetrics(metricsRegister: RegistryMetricCreator): QueueMetrics {
  return {
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
