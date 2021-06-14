export interface IForkChoiceMetrics {
  forkChoiceFindHead: IHistogram;
}

interface IHistogram {
  startTimer(): () => void;
}
