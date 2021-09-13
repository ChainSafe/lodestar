import {GaugeConfiguration} from "prom-client";
import {GaugeExtra} from "./gauge";

type GetValuesFn = () => number[];

/**
 * Special non-standard "Histogram" that captures the avg, min and max of values
 */
export class AvgMinMax<T extends string> {
  private readonly avg: GaugeExtra<string>;
  private readonly min: GaugeExtra<string>;
  private readonly max: GaugeExtra<string>;

  private getValuesFn: GetValuesFn | null = null;

  constructor(configuration: GaugeConfiguration<T>) {
    this.avg = new GaugeExtra({...configuration, name: `${configuration.name}_avg`});
    this.min = new GaugeExtra({...configuration, name: `${configuration.name}_min`});
    this.max = new GaugeExtra({...configuration, name: `${configuration.name}_max`});
  }

  addGetValuesFn(getValuesFn: GetValuesFn): void {
    if (this.getValuesFn === null) {
      this.getValuesFn = getValuesFn;

      this.avg.addCollect(this.onCollect);
    } else {
      throw Error("Already registered a getValuesFn");
    }
  }

  set(values: number[]): void {
    const {avg, min, max} = getStats(values);
    this.avg.set(avg);
    this.min.set(min);
    this.max.set(max);
  }

  private onCollect = (): void => {
    if (this.getValuesFn !== null) {
      this.set(this.getValuesFn());
    }
  };
}

type ArrStatistics = {
  avg: number;
  min: number;
  max: number;
};

function getStats(values: number[]): ArrStatistics {
  if (values.length < 1) {
    return {avg: 0, min: 0, max: 0};
  }

  let min = values[0];
  let max = values[0];
  let total = values[0];

  for (let i = 1; i < values.length; i++) {
    const val = values[i];
    if (val < min) min = val;
    if (val > max) max = val;
    total += val;
  }

  return {avg: total / values.length, min, max};
}
