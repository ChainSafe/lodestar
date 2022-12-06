import {Epoch} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "./types.js";
import {IAttesterStatus} from "./util/attesterStatus.js";

export interface IBeaconStateTransitionMetrics {
  stfnEpochTransition: IHistogram;
  stfnProcessBlock: IHistogram;
  stfnBalancesNodesPopulatedMiss: IGauge<"source">;
  stfnValidatorsNodesPopulatedMiss: IGauge<"source">;
  stfnStateClone: IGauge<"source">;
  stfnStateClonedCount: IHistogram;
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
  metrics.stfnStateClone.inc({source});
  metrics.stfnStateClonedCount.observe(state.clonedCount);

  if (!state.balances["nodesPopulated"]) {
    metrics.stfnBalancesNodesPopulatedMiss.inc({source});
  }

  // Given a CachedBeaconState, check if validators array internal cache is populated.
  // This cache is populated during epoch transition, and should be preserved for performance.
  // If the cache is missing too often, means that our clone strategy is not working well.
  if (!state.validators["nodesPopulated"]) {
    metrics.stfnValidatorsNodesPopulatedMiss.inc({source});
  }
}
