import {IAttesterStatus} from "./allForks";
import {Epoch} from "./phase0";

export interface IBeaconStateTransitionMetrics {
  stfnEpochTransition: IHistogram;
  stfnProcessBlock: IHistogram;
  registerValidatorStatuses: (currentEpoch: Epoch, statuses: IAttesterStatus[]) => void;
}

interface IHistogram {
  startTimer(): () => void;
}
