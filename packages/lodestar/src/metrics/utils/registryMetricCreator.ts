import {Gauge, GaugeConfiguration, Registry, HistogramConfiguration, CounterConfiguration, Counter} from "prom-client";
import {AvgMinMax} from "./avgMinMax";
import {GaugeExtra} from "./gauge";
import {HistogramExtra} from "./histogram";

type StaticConfiguration<T extends string> = {
  name: GaugeConfiguration<string>["name"];
  help: GaugeConfiguration<string>["help"];
  value: Record<T, string>;
};

export class RegistryMetricCreator extends Registry {
  gauge<T extends string>(configuration: GaugeConfiguration<T>): GaugeExtra<T> {
    return new GaugeExtra<T>({...configuration, registers: [this]});
  }

  histogram<T extends string>(configuration: HistogramConfiguration<T>): HistogramExtra<T> {
    return new HistogramExtra<T>({...configuration, registers: [this]});
  }

  avgMinMax<T extends string>(configuration: GaugeConfiguration<T>): AvgMinMax<T> {
    return new AvgMinMax<T>({...configuration, registers: [this]});
  }

  /** Static metric to send string-based data such as versions, config params, etc */
  static<T extends string>({name, help, value}: StaticConfiguration<T>): void {
    new Gauge({name, help, labelNames: Object.keys(value), registers: [this]}).set(value, 1);
  }

  counter<T extends string>(configuration: CounterConfiguration<T>): Counter<T> {
    return new Counter<T>({...configuration, registers: [this]});
  }
}
