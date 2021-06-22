export interface IForkChoiceMetrics {
  forkChoiceFindHead: IHistogram;
  forkChoiceHeadRequests: IGauge;
  forkChoiceErrors: IGauge;
  forkChoiceNewHeads: IGauge;
  forkChoiceNewChains: IGauge;
}

interface IHistogram {
  startTimer(): () => void;
}
interface IGauge {
  inc(value?: number): void;
}
