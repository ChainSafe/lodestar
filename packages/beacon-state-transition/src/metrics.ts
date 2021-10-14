import {Epoch} from "@chainsafe/lodestar-types";
import {IAttesterStatus} from "./allForks";

export interface IBeaconStateTransitionMetrics {
  stfnEpochTransition: IHistogram;
  stfnProcessBlock: IHistogram;
  registerValidatorStatuses: (currentEpoch: Epoch, statuses: IAttesterStatus[]) => void;
}

interface IHistogram {
  startTimer(): () => void;
}
