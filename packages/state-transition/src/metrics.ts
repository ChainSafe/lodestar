import {Epoch} from "@lodestar/types";
import {Gauge, Histogram} from "@lodestar/utils";
import {CachedBeaconStateAllForks} from "./types.js";
import {StateCloneSource, StateHashTreeRootSource} from "./stateTransition.js";
import {EpochTransitionStep} from "./epoch/index.js";

export type BeaconStateTransitionMetrics = {
  epochTransitionTime: Histogram;
  epochTransitionCommitTime: Histogram;
  epochTransitionStepTime: Histogram<{step: EpochTransitionStep}>;
  processBlockTime: Histogram;
  processBlockCommitTime: Histogram;
  stateHashTreeRootTime: Histogram<{source: StateHashTreeRootSource}>;
  numEffectiveBalanceUpdates: Gauge;
  preStateBalancesNodesPopulatedMiss: Gauge<{source: StateCloneSource}>;
  preStateBalancesNodesPopulatedHit: Gauge<{source: StateCloneSource}>;
  preStateValidatorsNodesPopulatedMiss: Gauge<{source: StateCloneSource}>;
  preStateValidatorsNodesPopulatedHit: Gauge<{source: StateCloneSource}>;
  preStateClonedCount: Histogram;
  postStateBalancesNodesPopulatedMiss: Gauge;
  postStateBalancesNodesPopulatedHit: Gauge;
  postStateValidatorsNodesPopulatedMiss: Gauge;
  postStateValidatorsNodesPopulatedHit: Gauge;
  registerValidatorStatuses: (
    currentEpoch: Epoch,
    inclusionDelays: number[],
    flags: number[],
    isActiveCurrEpoch: boolean[],
    isActivePrevEpoch: boolean[],
    balances?: number[]
  ) => void;
};

export type EpochCacheMetrics = {
  finalizedPubkeyDuplicateInsert: Gauge;
  newUnFinalizedPubkey: Gauge;
};

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
