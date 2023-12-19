import {Gauge, Registry, Counter, Histogram} from "prom-client";
import {
  AvgMinMaxConfig,
  CounterConfig,
  GaugeConfig,
  HistogramConfig,
  AvgMinMax as IAvgMinMax,
  Counter as ICounter,
  GaugeExtra as IGaugeExtra,
  Histogram as IHistogram,
  LabelKeys,
  LabelsGeneric,
  MetricsRegisterCustom,
  NoLabels,
  StaticConfig,
} from "@lodestar/utils";
import {AvgMinMax} from "./avgMinMax.js";
import {GaugeExtra} from "./gauge.js";

export class RegistryMetricCreator extends Registry implements MetricsRegisterCustom {
  gauge<Labels extends LabelsGeneric = NoLabels>(configuration: GaugeConfig<Labels>): IGaugeExtra<Labels> {
    return new GaugeExtra<Labels>({...configuration, registers: [this]});
  }

  histogram<Labels extends LabelsGeneric = NoLabels>(configuration: HistogramConfig<Labels>): IHistogram<Labels> {
    return new Histogram<LabelKeys<Labels>>({...configuration, registers: [this]});
  }

  avgMinMax<Labels extends LabelsGeneric = NoLabels>(configuration: AvgMinMaxConfig<Labels>): IAvgMinMax<Labels> {
    return new AvgMinMax<Labels>({...configuration, registers: [this]});
  }

  /** Static metric to send string-based data such as versions, config params, etc */
  static<Labels extends LabelsGeneric = NoLabels>({name, help, value}: StaticConfig<Labels>): void {
    new Gauge({name, help, labelNames: Object.keys(value), registers: [this]}).set(value, 1);
  }

  counter<Labels extends LabelsGeneric = NoLabels>(configuration: CounterConfig<Labels>): ICounter<Labels> {
    return new Counter<LabelKeys<Labels>>({...configuration, registers: [this]});
  }
}
