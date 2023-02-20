import {Epoch} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "./types.js";
import {IAttesterStatus} from "./util/attesterStatus.js";

export interface IBeaconStateTransitionMetrics {
  epochTransitionTime: IHistogram;
  epochTransitionCommitTime: IHistogram;
  processBlockTime: IHistogram;
  processBlockCommitTime: IHistogram;
  hashTreeRootTime: IHistogram;
  preStateBalancesNodesPopulatedMiss: IGauge<"source">;
  preStateValidatorsNodesPopulatedMiss: IGauge<"source">;
  preStateClone: IGauge<"source">;
  preStateClonedCount: IHistogram;
  postStateCount: IGauge;
  postStateBalancesNodesPopulatedMiss: IGauge;
  postStateValidatorsNodesPopulatedMiss: IGauge;
  registerValidatorStatuses: (currentEpoch: Epoch, statuses: IAttesterStatus[], balances?: number[]) => void;
}

type LabelValues<T extends string> = Partial<Record<T, string | number>>;

interface IHistogram<T extends string = string> {
  startTimer(): () => void;

  observe(value: number): void;
  observe(labels: LabelValues<T>, values: number): void;
  observe(arg1: LabelValues<T> | number, arg2?: number): void;
}

interface IGauge<T extends string = string> {
  inc(value?: number): void;
  inc(labels: LabelValues<T>, value?: number): void;
  inc(arg1?: LabelValues<T> | number, arg2?: number): void;
}

export function onStateCloneMetrics(
  state: CachedBeaconStateAllForks,
  metrics: IBeaconStateTransitionMetrics,
  source: "stateTransition" | "processSlots"
): void {
  metrics.preStateClone.inc({source});
  metrics.preStateClonedCount.observe(state.clonedCount);

  if (!isBalancesNodesPopulated(state)) {
    metrics.preStateBalancesNodesPopulatedMiss.inc({source});
  }

  if (!isValidatorsNodesPopulated(state)) {
    metrics.preStateValidatorsNodesPopulatedMiss.inc({source});
  }
}

export function onPostStateMetrics(postState: CachedBeaconStateAllForks, metrics: IBeaconStateTransitionMetrics): void {
  metrics.postStateCount.inc();

  if (!isBalancesNodesPopulated(postState)) {
    metrics.postStateBalancesNodesPopulatedMiss.inc();
  }

  if (!isValidatorsNodesPopulated(postState)) {
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
