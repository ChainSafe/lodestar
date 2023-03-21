import {Epoch} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "./types.js";
import {AttesterStatus} from "./util/attesterStatus.js";

export type BeaconStateTransitionMetrics = {
  epochTransitionTime: Histogram;
  epochTransitionCommitTime: Histogram;
  processBlockTime: Histogram;
  processBlockCommitTime: Histogram;
  stateHashTreeRootTime: Histogram;
  preStateBalancesNodesPopulatedMiss: Gauge<"source">;
  preStateBalancesNodesPopulatedHit: Gauge<"source">;
  preStateValidatorsNodesPopulatedMiss: Gauge<"source">;
  preStateValidatorsNodesPopulatedHit: Gauge<"source">;
  preStateClonedCount: Histogram;
  postStateBalancesNodesPopulatedMiss: Gauge;
  postStateBalancesNodesPopulatedHit: Gauge;
  postStateValidatorsNodesPopulatedMiss: Gauge;
  postStateValidatorsNodesPopulatedHit: Gauge;
  registerValidatorStatuses: (currentEpoch: Epoch, statuses: AttesterStatus[], balances?: number[]) => void;
};

type LabelValues<T extends string> = Partial<Record<T, string | number>>;

interface Histogram<T extends string = string> {
  startTimer(): () => void;

  observe(value: number): void;
  observe(labels: LabelValues<T>, values: number): void;
  observe(arg1: LabelValues<T> | number, arg2?: number): void;
}

interface Gauge<T extends string = string> {
  inc(value?: number): void;
  inc(labels: LabelValues<T>, value?: number): void;
  inc(arg1?: LabelValues<T> | number, arg2?: number): void;
}

export function onStateCloneMetrics(
  state: CachedBeaconStateAllForks,
  metrics: BeaconStateTransitionMetrics,
  source: "stateTransition" | "processSlots"
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
  return state.validators["nodesPopulated"] === true;
}

function isBalancesNodesPopulated(state: CachedBeaconStateAllForks): boolean {
  return state.balances["nodesPopulated"] === true;
}
