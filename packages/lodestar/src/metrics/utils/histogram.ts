import {Histogram, HistogramConfiguration} from "prom-client";
import {IHistogram} from "../interface";

type Labels<T extends string> = Partial<Record<T, string | number>>;

/**
 * Extends the prom-client Histogram with extra features:
 * - Add multiple collect functions after instantiation
 * - Create child histograms with fixed labels
 */
export class HistogramExtra<T extends string> extends Histogram<T> implements IHistogram {
  constructor(configuration: HistogramConfiguration<T>) {
    super(configuration);
  }

  child(labels: Labels<T>): HistogramChild<T> {
    return new HistogramChild(labels, this);
  }
}

export class HistogramChild<T extends string> implements IHistogram {
  histogram: HistogramExtra<T>;
  labelsParent: Labels<T>;
  constructor(labelsParent: Labels<T>, histogram: HistogramExtra<T>) {
    this.histogram = histogram;
    this.labelsParent = labelsParent;
  }

  // Sorry for this mess, `prom-client` API choices are not great
  // If the function signature was `observe(value: number, labels?: Labels)`, this would be simpler
  observe(value?: number): void;
  observe(labels: Labels<T>, value?: number): void;
  observe(arg1?: Labels<T> | number, arg2?: number): void {
    if (typeof arg1 === "object") {
      this.histogram.observe({...this.labelsParent, ...arg1}, arg2 ?? 0);
    } else {
      this.histogram.observe(this.labelsParent, arg1 ?? 0);
    }
  }

  startTimer(arg1?: Labels<T>): (labels?: Labels<T>) => number {
    if (typeof arg1 === "object") {
      return this.histogram.startTimer({...this.labelsParent, ...arg1});
    } else {
      return this.histogram.startTimer(this.labelsParent);
    }
  }
}
