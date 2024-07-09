import {NonEmptyArray} from "./types.js";

export type NoLabels = Record<string, never>;
export type LabelsGeneric = Record<string, string | number>;
export type LabelKeys<Labels extends LabelsGeneric> = Extract<keyof Labels, string>;
export type CollectFn<Labels extends LabelsGeneric> = (metric: Gauge<Labels>) => void;

export interface Gauge<Labels extends LabelsGeneric = NoLabels> {
  inc: NoLabels extends Labels ? (value?: number) => void : (labels: Labels, value?: number) => void;
  dec: NoLabels extends Labels ? (value?: number) => void : (labels: Labels, value?: number) => void;
  set: NoLabels extends Labels ? (value: number) => void : (labels: Labels, value: number) => void;

  collect?(): void;
}

export interface GaugeExtra<Labels extends LabelsGeneric = NoLabels> extends Omit<Gauge<Labels>, "collect"> {
  addCollect(collectFn: CollectFn<Labels>): void;
}

export interface Histogram<Labels extends LabelsGeneric = NoLabels> {
  startTimer(): NoLabels extends Labels ? () => number : (labels: Labels) => number;
  startTimer<L extends Partial<Labels>>(
    labels?: NoLabels extends Labels ? never : L
  ): keyof Omit<Labels, keyof L> extends never ? () => number : (labels: Omit<Labels, keyof L>) => number;

  observe: NoLabels extends Labels ? (value: number) => void : (labels: Labels, value: number) => void;

  reset(): void;
}

export interface AvgMinMax<Labels extends LabelsGeneric = NoLabels> {
  addGetValuesFn(getValuesFn: () => number[]): void;

  set: NoLabels extends Labels ? (values: number[]) => void : (labels: Labels, values: number[]) => void;
}

export interface Counter<Labels extends LabelsGeneric = NoLabels> {
  inc: NoLabels extends Labels ? (value?: number) => void : (labels: Labels, value?: number) => void;
}

export type GaugeConfig<Labels extends LabelsGeneric> = {
  name: string;
  help: string;
} & (NoLabels extends Labels ? {labelNames?: never} : {labelNames: NonEmptyArray<LabelKeys<Labels>>});

export type HistogramConfig<Labels extends LabelsGeneric> = GaugeConfig<Labels> & {
  buckets?: number[];
};

export type AvgMinMaxConfig<Labels extends LabelsGeneric> = GaugeConfig<Labels>;

export type CounterConfig<Labels extends LabelsGeneric> = GaugeConfig<Labels>;

export type StaticConfig<Labels extends LabelsGeneric> = {
  name: GaugeConfig<Labels>["name"];
  help: GaugeConfig<Labels>["help"];
  value: Record<LabelKeys<Labels>, string>;
};

export interface MetricsRegister {
  gauge<Labels extends LabelsGeneric = NoLabels>(config: GaugeConfig<Labels>): Gauge<Labels>;
  histogram<Labels extends LabelsGeneric = NoLabels>(config: HistogramConfig<Labels>): Histogram<Labels>;
  counter<Labels extends LabelsGeneric = NoLabels>(config: CounterConfig<Labels>): Counter<Labels>;
}

export interface MetricsRegisterExtra extends MetricsRegister {
  gauge<Labels extends LabelsGeneric = NoLabels>(config: GaugeConfig<Labels>): GaugeExtra<Labels>;
}

export interface MetricsRegisterCustom extends MetricsRegisterExtra {
  avgMinMax<Labels extends LabelsGeneric = NoLabels>(config: AvgMinMaxConfig<Labels>): AvgMinMax<Labels>;
  static<Labels extends LabelsGeneric = NoLabels>(config: StaticConfig<Labels>): void;
}
