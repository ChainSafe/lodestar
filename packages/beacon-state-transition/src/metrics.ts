import {Epoch} from "@chainsafe/lodestar-types";
import {IAttesterStatus} from "./util/attesterStatus.js";

export interface IBeaconStateTransitionMetrics {
  stfnEpochTransition: IHistogram;
  stfnProcessBlock: IHistogram;
  registerValidatorStatuses: (currentEpoch: Epoch, statuses: IAttesterStatus[], balances?: number[]) => void;
}

interface IHistogram {
  startTimer(): () => void;
}
