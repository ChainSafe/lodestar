export interface IBeaconStateTransitionMetrics {
  stfnEpochTransition: IHistogram;
  stfnProcessBlock: IHistogram;
}

interface IHistogram {
  startTimer(): () => void;
}
