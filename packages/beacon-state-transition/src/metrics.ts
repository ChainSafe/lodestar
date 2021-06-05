import {IEpochProcess} from "./allForks";

export interface IBeaconStateTransitionMetrics {
  stfnEpochTransition: IHistogram;
  stfnProcessBlock: IHistogram;
  registerParticipation: (process: IEpochProcess) => void;
}

interface IHistogram {
  startTimer(): () => void;
}
