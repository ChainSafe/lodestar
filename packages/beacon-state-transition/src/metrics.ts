import {Epoch} from "@chainsafe/lodestar-types";
import {IAttesterStatus} from "./util/attesterStatus";

export interface IBeaconStateTransitionMetrics {
  stfnEpochTransition: IHistogram;
  stfnProcessBlock: IHistogram;
  stfnElapsedTimeTillProcessed: IHistogram;
  registerValidatorStatuses: (currentEpoch: Epoch, statuses: IAttesterStatus[], balances?: number[]) => void;
}

interface IHistogram {
  startTimer(): () => void;
  observe(value: number): void;
}
