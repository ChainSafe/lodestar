import {Gauge, Histogram} from "prom-client";

type CollectFn<T extends string> = (metric: IGauge<T>) => void;

export type IGauge<T extends string = string> = Pick<Gauge<T>, "inc" | "dec" | "set"> & {
  addCollect: (collectFn: CollectFn<T>) => void;
};

export type IHistogram<T extends string = string> = Pick<Histogram<T>, "observe" | "startTimer">;

export type IAvgMinMax = {
  addGetValuesFn(getValuesFn: () => number[]): void;
  set(values: number[]): void;
};
