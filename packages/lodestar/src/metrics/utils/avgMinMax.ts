import {GaugeConfiguration} from "prom-client";
import {GaugeExtra} from "./gauge";

type GetValuesFn = () => number[];
type Labels<T extends string> = Partial<Record<T, string | number>>;

/**
 * Special non-standard "Histogram" that captures the avg, min and max of values
 */
export class AvgMinMax<T extends string> {
  private readonly sum: GaugeExtra<string>;
  private readonly avg: GaugeExtra<string>;
  private readonly min: GaugeExtra<string>;
  private readonly max: GaugeExtra<string>;

  private getValuesFn: GetValuesFn | null = null;

  constructor(configuration: GaugeConfiguration<T>) {
    this.sum = new GaugeExtra({...configuration, name: `${configuration.name}_sum`});
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

  set(values: number[]): void;
  set(labels: Labels<T>, values: number[]): void;
  set(arg1?: Labels<T> | number[], arg2?: number[]): void {
    if (arg2 === undefined) {
      const values = arg1 as number[];
      const {sum, avg, min, max} = getStats(values);
      this.sum.set(sum);
      this.avg.set(avg);
      this.min.set(min);
      this.max.set(max);
    } else {
      const values = (arg2 !== undefined ? arg2 : arg1) as number[];
      const labels = arg1 as Labels<T>;
      const {sum, avg, min, max} = getStats(values);
      this.sum.set(labels, sum);
      this.avg.set(labels, avg);
      this.min.set(labels, min);
      this.max.set(labels, max);
    }
  }

  private onCollect = (): void => {
    if (this.getValuesFn !== null) {
      this.set(this.getValuesFn());
    }
  };
}

type ArrStatistics = {
  sum: number;
  avg: number;
  min: number;
  max: number;
};

function getStats(values: number[]): ArrStatistics {
  if (values.length < 1) {
    return {sum: 0, avg: 0, min: 0, max: 0};
  }

  let min = values[0];
  let max = values[0];
  let sum = values[0];

  for (let i = 1; i < values.length; i++) {
    const val = values[i];
    if (val < min) min = val;
    if (val > max) max = val;
    sum += val;
  }

  return {sum, avg: sum / values.length, min, max};
}
