import {Gauge, Histogram} from "prom-client";

export type IGauge<T extends string = string> = Pick<Gauge<T>, "inc" | "set"> & {
  addCollect: (collectFn: () => void) => void;
};

export type IHistogram<T extends string = string> = Pick<Histogram<T>, "observe" | "startTimer">;

export type IAvgMinMax = {
  addGetValuesFn(getValuesFn: () => number[]): void;
  set(values: number[]): void;
};
