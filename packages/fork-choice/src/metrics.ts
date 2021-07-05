export interface IForkChoiceMetrics {
  forkChoiceFindHead: IHistogram;
  forkChoiceRequests: IGauge;
  forkChoiceErrors: IGauge;
  forkChoiceChangedHead: IGauge;
  forkChoiceReorg: IGauge;
}

interface IHistogram {
  startTimer(): () => void;
}
interface IGauge {
  inc(value?: number): void;
}
