import {Epoch} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "./types.js";
import {AttesterStatus} from "./util/attesterStatus.js";

export type BeaconStateTransitionMetrics = {
  stfnEpochTransition: Histogram;
  stfnProcessBlock: Histogram;
  stfnBalancesNodesPopulatedMiss: Gauge<"source">;
  stfnValidatorsNodesPopulatedMiss: Gauge<"source">;
  stfnStateClone: Gauge<"source">;
  stfnStateClonedCount: Histogram;
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
