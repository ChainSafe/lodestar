export type LabelsGeneric = Record<string, string | number>;
export type LabelKeys<Labels extends LabelsGeneric> = Extract<keyof Labels, string>;
export type CollectFn<Labels extends LabelsGeneric> = (metric: Gauge<Labels>) => void;

// Type `{}` is required here as alternative types do not work
// eslint-disable-next-line @typescript-eslint/ban-types
export type NoLabels = {};

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
  startTimer(labels: NoLabels extends Labels ? undefined : Labels): (labels?: Labels) => number;

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
} & (NoLabels extends Labels ? {labelNames?: never} : {labelNames: [LabelKeys<Labels>, ...LabelKeys<Labels>[]]});

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
  gauge<Labels extends LabelsGeneric>(config: GaugeConfig<Labels>): Gauge<Labels>;
  histogram<Labels extends LabelsGeneric>(config: HistogramConfig<Labels>): Histogram<Labels>;
  counter<Labels extends LabelsGeneric>(config: CounterConfig<Labels>): Counter<Labels>;
}

export interface MetricsRegisterExtra extends MetricsRegister {
  gauge<Labels extends LabelsGeneric>(config: GaugeConfig<Labels>): GaugeExtra<Labels>;
}

export interface MetricsRegisterCustom extends MetricsRegisterExtra {
  avgMinMax<Labels extends LabelsGeneric>(config: AvgMinMaxConfig<Labels>): AvgMinMax<Labels>;
  static<Labels extends LabelsGeneric>(config: StaticConfig<Labels>): void;
}
