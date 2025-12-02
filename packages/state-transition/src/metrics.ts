import {MetricsRegister} from "@lodestar/utils";
import {ProposerRewardType} from "./block/types.js";
import {EpochTransitionStep} from "./epoch/index.js";
import {StateCloneSource, StateHashTreeRootSource} from "./stateTransition.js";
import {CachedBeaconStateAllForks} from "./types.js";

export type BeaconStateTransitionMetrics = ReturnType<typeof getMetrics>;

/**
 * A collection of metrics used throughout the State Transition.
 */
export function getMetrics(register: MetricsRegister) {
  // Using function style instead of class to prevent having to re-declare all MetricsPrometheus types.

  return {
    epochTransitionTime: register.histogram({
      name: "lodestar_stfn_epoch_transition_seconds",
      help: "Time to process a single epoch transition in seconds",
      // as of Sep 2025, on mainnet, epoch transition time of lodestar is never less than 0.5s, and it could be up to 3s
      buckets: [0.2, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 10],
    }),
    epochTransitionCommitTime: register.histogram({
      name: "lodestar_stfn_epoch_transition_commit_seconds",
      help: "Time to call commit after process a single epoch transition in seconds",
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
    }),
    epochTransitionStepTime: register.histogram<{step: EpochTransitionStep}>({
      name: "lodestar_stfn_epoch_transition_step_seconds",
      help: "Time to call each step of epoch transition in seconds",
      labelNames: ["step"],
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
    }),
    processBlockTime: register.histogram({
      name: "lodestar_stfn_process_block_seconds",
      help: "Time to process a single block in seconds",
      // TODO: Add metrics for each step
      // Block processing can take 5-40ms, 100ms max
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 1],
    }),
    processBlockCommitTime: register.histogram({
      name: "lodestar_stfn_process_block_commit_seconds",
      help: "Time to call commit after process a single block in seconds",
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 1],
    }),
    stateHashTreeRootTime: register.histogram<{source: StateHashTreeRootSource}>({
      name: "lodestar_stfn_hash_tree_root_seconds",
      help: "Time to compute the hash tree root of a post state in seconds",
      buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5],
      labelNames: ["source"],
    }),
    numEffectiveBalanceUpdates: register.gauge({
      name: "lodestar_stfn_effective_balance_updates_count",
      help: "Total count of effective balance updates",
    }),
    validatorsInActivationQueue: register.gauge({
      name: "lodestar_stfn_validators_in_activation_queue",
      help: "Current number of validators in the activation queue",
    }),
    validatorsInExitQueue: register.gauge({
      name: "lodestar_stfn_validators_in_exit_queue",
      help: "Current number of validators in the exit queue",
    }),
    preStateBalancesNodesPopulatedMiss: register.gauge<{source: StateCloneSource}>({
      name: "lodestar_stfn_balances_nodes_populated_miss_total",
      help: "Total count state.balances nodesPopulated is false on stfn",
      labelNames: ["source"],
    }),
    preStateBalancesNodesPopulatedHit: register.gauge<{source: StateCloneSource}>({
      name: "lodestar_stfn_balances_nodes_populated_hit_total",
      help: "Total count state.balances nodesPopulated is true on stfn",
      labelNames: ["source"],
    }),
    preStateValidatorsNodesPopulatedMiss: register.gauge<{source: StateCloneSource}>({
      name: "lodestar_stfn_validators_nodes_populated_miss_total",
      help: "Total count state.validators nodesPopulated is false on stfn",
      labelNames: ["source"],
    }),
    preStateValidatorsNodesPopulatedHit: register.gauge<{source: StateCloneSource}>({
      name: "lodestar_stfn_validators_nodes_populated_hit_total",
      help: "Total count state.validators nodesPopulated is true on stfn",
      labelNames: ["source"],
    }),
    preStateClonedCount: register.histogram({
      name: "lodestar_stfn_state_cloned_count",
      help: "Histogram of cloned count per state every time state.clone() is called",
      buckets: [1, 2, 5, 10, 50, 250],
    }),
    postStateBalancesNodesPopulatedHit: register.gauge({
      name: "lodestar_stfn_post_state_balances_nodes_populated_hit_total",
      help: "Total count state.validators nodesPopulated is true on stfn for post state",
    }),
    postStateBalancesNodesPopulatedMiss: register.gauge({
      name: "lodestar_stfn_post_state_balances_nodes_populated_miss_total",
      help: "Total count state.validators nodesPopulated is false on stfn for post state",
    }),
    postStateValidatorsNodesPopulatedHit: register.gauge({
      name: "lodestar_stfn_post_state_validators_nodes_populated_hit_total",
      help: "Total count state.validators nodesPopulated is true on stfn for post state",
    }),
    postStateValidatorsNodesPopulatedMiss: register.gauge({
      name: "lodestar_stfn_post_state_validators_nodes_populated_miss_total",
      help: "Total count state.validators nodesPopulated is false on stfn for post state",
    }),
    newSeenAttestersPerBlock: register.gauge({
      name: "lodestar_stfn_new_seen_attesters_per_block_total",
      help: "Total count of new seen attesters per block",
    }),
    newSeenAttestersEffectiveBalancePerBlock: register.gauge({
      name: "lodestar_stfn_new_seen_attesters_effective_balance_per_block_total",
      help: "Total effective balance increment of new seen attesters per block",
    }),
    attestationsPerBlock: register.gauge({
      name: "lodestar_stfn_attestations_per_block_total",
      help: "Total count of attestations per block",
    }),
    proposerRewards: register.gauge<{type: ProposerRewardType}>({
      name: "lodestar_stfn_proposer_rewards_total",
      help: "Proposer reward by type per block",
      labelNames: ["type"],
    }),
  };
}

export function onStateCloneMetrics(
  state: CachedBeaconStateAllForks,
  metrics: BeaconStateTransitionMetrics,
  source: StateCloneSource
): void {
  metrics.preStateClonedCount.observe(state.clonedCount);

  if (isBalancesNodesPopulated(state)) {
    metrics.preStateBalancesNodesPopulatedHit.inc({source});
  } else {
    metrics.preStateBalancesNodesPopulatedMiss.inc({source});
  }

  if (isValidatorsNodesPopulated(state)) {
    metrics.preStateValidatorsNodesPopulatedHit.inc({source});
  } else {
    metrics.preStateValidatorsNodesPopulatedMiss.inc({source});
  }
}

export function onPostStateMetrics(postState: CachedBeaconStateAllForks, metrics: BeaconStateTransitionMetrics): void {
  if (isBalancesNodesPopulated(postState)) {
    metrics.postStateBalancesNodesPopulatedHit.inc();
  } else {
    metrics.postStateBalancesNodesPopulatedMiss.inc();
  }

  if (isValidatorsNodesPopulated(postState)) {
    metrics.postStateValidatorsNodesPopulatedHit.inc();
  } else {
    metrics.postStateValidatorsNodesPopulatedMiss.inc();
  }
}

// Given a CachedBeaconState, check if validators array internal cache is populated.
// This cache is populated during epoch transition, and should be preserved for performance.
// If the cache is missing too often, means that our clone strategy is not working well.
function isValidatorsNodesPopulated(state: CachedBeaconStateAllForks): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: It is a private attribute
  return state.validators["nodesPopulated"] === true;
}

function isBalancesNodesPopulated(state: CachedBeaconStateAllForks): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: It is a private attribute
  return state.balances["nodesPopulated"] === true;
}
