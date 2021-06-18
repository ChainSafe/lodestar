export interface IForkChoiceMetrics {
  forkChoiceFindHead: IHistogram<"syncStatus" | "resStatus">;
}

type Labels<T extends string> = Partial<Record<T, string | number>>;
interface IHistogram<T extends string> {
  startTimer(arg?: Labels<T>): (arg?: Labels<T>) => void;
}
