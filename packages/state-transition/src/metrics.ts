import {MetricsRegister} from "@lodestar/utils";
import {ProposerRewardType} from "./block/types.js";
import {StateCloneSource, StateTransitionSource} from "./stateTransition.js";
import {CachedBeaconStateAllForks} from "./types.js";

export type BeaconStateTransitionMetrics = ReturnType<typeof getMetrics>;

/**
 * A collection of metrics used throughout the State Transition.
 */
export function getMetrics(register: MetricsRegister) {
  // Using function style instead of class to prevent having to re-declare all MetricsPrometheus types.

  return {
    // lodestar_block_processor dashboard, lodestar_summary dashboard
    epochTransitionTime: register.histogram<{source: StateTransitionSource}>({
      name: "lodestar_stfn_epoch_transition_seconds",
      help: "Time to process a single epoch transition in seconds",
      labelNames: ["source"],
      // Epoch transitions are 100ms on very fast clients, and average 800ms on heavy networks
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1, 1.25, 1.5, 3, 10],
    }),
    // lodestar_block_processor dashboard
    epochTransitionCommitTime: register.histogram<{source: StateTransitionSource}>({
      name: "lodestar_stfn_epoch_transition_commit_seconds",
      help: "Time to call commit after process a single epoch transition in seconds",
      labelNames: ["source"],
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
    }),
    // lodestar_block_processor dashboard
    epochTransitionStepTime: {
      beforeProcessEpoch: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_before_process_epoch_seconds",
        help: "Time to call beforeProcessEpoch step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      afterProcessEpoch: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_after_process_epoch_seconds",
        help: "Time to call afterProcessEpoch step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      finalProcessEpoch: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_final_process_epoch_seconds",
        help: "Time to call finalProcessEpoch step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      processJustificationAndFinalization: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_process_justification_and_finalization_seconds",
        help: "Time to call processJustificationAndFinalization step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      processInactivityUpdates: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_process_inactivity_updates_seconds",
        help: "Time to processInactivityUpdates each step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      processRegistryUpdates: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_process_registry_updates_seconds",
        help: "Time to processRegistryUpdates each step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      processSlashings: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_process_slashings_seconds",
        help: "Time to call processSlashings step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      processRewardsAndPenalties: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_process_rewards_and_penalties_seconds",
        help: "Time to call processRewardsAndPenalties step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      processEffectiveBalanceUpdates: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_process_effective_balance_updates_seconds",
        help: "Time to processEffectiveBalanceUpdates each step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      processParticipationFlagUpdates: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_process_participation_flag_updates_seconds",
        help: "Time to processParticipationFlagUpdates each step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      processSyncCommitteeUpdates: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_process_sync_committee_updates_seconds",
        help: "Time to call processSyncCommitteeUpdates step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      processPendingDeposits: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_process_pending_deposits_seconds",
        help: "Time to processPendingDeposits each step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      processPendingConsolidations: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_process_pending_consolidations_seconds",
        help: "Time to processPendingConsolidations each step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
      processProposerLookahead: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_epoch_transition_step_process_proposer_lookahead_seconds",
        help: "Time to call processProposerLookahead step of epoch transition in seconds",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
      }),
    },
    // lodestar_block_processor dashboard
    processBlockTime: register.histogram<{source: StateTransitionSource}>({
      name: "lodestar_stfn_process_block_seconds",
      help: "Time to process a single block in seconds",
      labelNames: ["source"],
      // TODO: Add metrics for each step
      // Block processing can take 5-40ms, 100ms max
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 1],
    }),
    // lodestar_block_processor dashboard
    processBlockCommitTime: register.histogram<{source: StateTransitionSource}>({
      name: "lodestar_stfn_process_block_commit_seconds",
      help: "Time to call commit after process a single block in seconds",
      labelNames: ["source"],
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 1],
    }),
    // lodestar_block_processor dashboard
    stateHashTreeRootTime: {
      stateTransition: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_hash_tree_root_state_transition_seconds",
        help: "Time to compute the hash tree root of a post state in state transition in seconds",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5],
        labelNames: ["source"],
      }),
      
      blockTransition: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_hash_tree_root_block_transition_seconds",
        help: "Time to compute the hash tree root of a post state in block verification in seconds",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5],
        labelNames: ["source"],
      }),
      prepareNextSlot: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_hash_tree_root_prepare_next_slot_seconds",
        help: "Time to compute the hash tree root of a state preparing next slot in seconds",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5],
        labelNames: ["source"],
      }),
      prepareNextEpoch: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_hash_tree_root_prepare_next_epoch_seconds",
        help: "Time to compute the hash tree root of a state preparing next epoch in seconds",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5],
        labelNames: ["source"],
      }),
      regenState: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_hash_tree_root_regen_state_seconds",
        help: "Time to compute the hash tree root of a state in regen in seconds",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5],
        labelNames: ["source"],
      }),
      computeNewStateRoot: register.histogram<{source: StateTransitionSource}>({
        name: "lodestar_stfn_hash_tree_root_compute_new_state_root_seconds",
        help: "Time to compute the hash tree root of a post state computing new state root in seconds",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5],
        labelNames: ["source"],
      }),
    },
    // not on dashboard
    numEffectiveBalanceUpdates: register.gauge({
      name: "lodestar_stfn_effective_balance_updates_count",
      help: "Total count of effective balance updates",
    }),
    // lodestar_summary dashboard
    validatorsInActivationQueue: register.gauge({
      name: "lodestar_stfn_validators_in_activation_queue",
      help: "Current number of validators in the activation queue",
    }),
    // lodestar_summary dashboard
    validatorsInExitQueue: register.gauge({
      name: "lodestar_stfn_validators_in_exit_queue",
      help: "Current number of validators in the exit queue",
    }),
    // lodestar_block_processor dashboard
    preStateBalancesNodesPopulatedMiss: register.gauge<{source: StateCloneSource}>({
      name: "lodestar_stfn_balances_nodes_populated_miss_total",
      help: "Total count state.balances nodesPopulated is false on stfn",
      labelNames: ["source"],
    }),
    // not on dashboard
    preStateBalancesNodesPopulatedHit: register.gauge<{source: StateCloneSource}>({
      name: "lodestar_stfn_balances_nodes_populated_hit_total",
      help: "Total count state.balances nodesPopulated is true on stfn",
      labelNames: ["source"],
    }),
    // lodestar_block_processor dashboard
    preStateValidatorsNodesPopulatedMiss: register.gauge<{source: StateCloneSource}>({
      name: "lodestar_stfn_validators_nodes_populated_miss_total",
      help: "Total count state.validators nodesPopulated is false on stfn",
      labelNames: ["source"],
    }),
    // not on dashboard
    preStateValidatorsNodesPopulatedHit: register.gauge<{source: StateCloneSource}>({
      name: "lodestar_stfn_validators_nodes_populated_hit_total",
      help: "Total count state.validators nodesPopulated is true on stfn",
      labelNames: ["source"],
    }),
    // lodestar_block_processor dashboard
    preStateClonedCount: register.histogram<{source: StateCloneSource}>({
      name: "lodestar_stfn_state_cloned_count",
      help: "Histogram of cloned count per state every time state.clone() is called",
      buckets: [1, 2, 5, 10, 50, 250],
      labelNames: ["source"],
    }),
    // not on dashboard
    postStateBalancesNodesPopulatedHit: register.gauge({
      name: "lodestar_stfn_post_state_balances_nodes_populated_hit_total",
      help: "Total count state.balances nodesPopulated is true on stfn for post state",
    }),
    // not on dashboard
    postStateBalancesNodesPopulatedMiss: register.gauge({
      name: "lodestar_stfn_post_state_balances_nodes_populated_miss_total",
      help: "Total count state.balances nodesPopulated is false on stfn for post state",
    }),
    // not on dashboard
    postStateValidatorsNodesPopulatedHit: register.gauge({
      name: "lodestar_stfn_post_state_validators_nodes_populated_hit_total",
      help: "Total count state.validators nodesPopulated is true on stfn for post state",
    }),
    // not on dashboard
    postStateValidatorsNodesPopulatedMiss: register.gauge({
      name: "lodestar_stfn_post_state_validators_nodes_populated_miss_total",
      help: "Total count state.validators nodesPopulated is false on stfn for post state",
    }),
    // lodestar_block_production dashboard
    newSeenAttestersPerBlock: register.gauge({
      name: "lodestar_stfn_new_seen_attesters_per_block_total",
      help: "Total count of new seen attesters per block",
    }),
    // not on dashboard
    newSeenAttestersEffectiveBalancePerBlock: register.gauge({
      name: "lodestar_stfn_new_seen_attesters_effective_balance_per_block_total",
      help: "Total effective balance increment of new seen attesters per block",
    }),
    // not on dashboard
    attestationsPerBlock: register.gauge({
      name: "lodestar_stfn_attestations_per_block_total",
      help: "Total count of attestations per block",
    }),
    // not on dashboard
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
