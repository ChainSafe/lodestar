import {Gauge} from "prom-client";
import {CollectFn, Gauge as IGauge, LabelKeys, LabelsGeneric} from "@lodestar/utils";

/**
 * Extends the prom-client Gauge to be able to add multiple collect functions after instantiation
 */
export class GaugeExtra<Labels extends LabelsGeneric> extends Gauge<LabelKeys<Labels>> implements IGauge<Labels> {
  private collectFns: CollectFn<Labels>[] = [];

  addCollect(collectFn: CollectFn<Labels>): void {
    this.collectFns.push(collectFn);
  }

  /**
   * @override Metric.collect
   */
  collect(): void {
    for (const collectFn of this.collectFns) {
      collectFn(this);
    }
  }
}
