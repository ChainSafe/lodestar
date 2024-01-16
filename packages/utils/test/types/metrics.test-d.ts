import {describe, it, expectTypeOf} from "vitest";
import {Counter as PromCounter, Gauge as PromGauge, Histogram as PromHistogram} from "prom-client";
import {Counter, Gauge, Histogram, MetricsRegister} from "../../src/metrics.js";

describe("Metric types", () => {
  type Labels = {label: string};
  type MultipleLabels = {label1: string; label2: string};

  describe("MetricsRegister", () => {
    const register = {} as MetricsRegister;

    it("should require name and help to be defined on each metric", () => {
      expectTypeOf(register.gauge).parameter(0).toHaveProperty("name").toBeString();
      expectTypeOf(register.gauge).parameter(0).toHaveProperty("help").toBeString();
    });

    it("should require to set labelNames if metric has defined labels", () => {
      expectTypeOf(register.gauge<Labels>)
        .parameter(0)
        .toHaveProperty("labelNames")
        .toMatchTypeOf<"label"[]>();

      expectTypeOf(register.gauge<MultipleLabels>)
        .parameter(0)
        .toHaveProperty("labelNames")
        .toMatchTypeOf<("label1" | "label2")[]>();
    });

    it("should not require to set labelNames if metric has no labels", () => {
      expectTypeOf(register.gauge).parameter(0).toHaveProperty("labelNames").toEqualTypeOf<undefined>();
    });
  });

  describe("Gauge", () => {
    it("should be compatible with prom-client type", () => {
      expectTypeOf<PromGauge>().toMatchTypeOf<Gauge>();
    });

    it("should require to set labels if metric has defined labels", () => {
      const gauge = {} as Gauge<Labels>;

      expectTypeOf(gauge.inc).toEqualTypeOf<(labels: Labels, value?: number | undefined) => void>();
      expectTypeOf(gauge.dec).toEqualTypeOf<(labels: Labels, value?: number | undefined) => void>();
      expectTypeOf(gauge.set).toEqualTypeOf<(labels: Labels, value: number) => void>();
    });

    it("should not require to set labels if metric has no labels", () => {
      const gauge = {} as Gauge;

      expectTypeOf(gauge.inc).toEqualTypeOf<(value?: number | undefined) => void>();
      expectTypeOf(gauge.dec).toEqualTypeOf<(value?: number | undefined) => void>();
      expectTypeOf(gauge.set).toEqualTypeOf<(value: number) => void>();
    });
  });

  describe("Histogram", () => {
    it("should be compatible with prom-client type", () => {
      expectTypeOf<PromHistogram>().toMatchTypeOf<Histogram>();
    });

    it("should require to set labels if metric has defined labels", () => {
      const histogram = {} as Histogram<Labels>;

      expectTypeOf(histogram.startTimer).toMatchTypeOf<(labels: Labels) => () => number>();
      expectTypeOf(histogram.observe).toEqualTypeOf<(labels: Labels, value: number) => void>();
    });

    it("should require to set labels in timer if not set in startTimer", () => {
      const histogram = {} as Histogram<MultipleLabels>;

      const timer = histogram.startTimer();
      expectTypeOf(timer).toEqualTypeOf<(labels: MultipleLabels) => number>();
    });

    it("should not require to set labels in timer if already set in startTimer", () => {
      const histogram = {} as Histogram<MultipleLabels>;

      const timer = histogram.startTimer({label1: "value1", label2: "label2"});
      expectTypeOf(timer).toEqualTypeOf<() => number>();
    });

    it("should allow to set labels in either startTimer or timer", () => {
      const histogram = {} as Histogram<MultipleLabels>;

      const timer = histogram.startTimer({label1: "value1"});
      expectTypeOf(timer).toEqualTypeOf<(labels: {label2: string}) => number>();
    });

    it("should not require to set labels if metric has no labels", () => {
      const histogram = {} as Histogram;

      expectTypeOf(histogram.startTimer).toMatchTypeOf<() => () => number>();
      expectTypeOf(histogram.observe).toEqualTypeOf<(value: number) => void>();
    });
  });

  describe("Counter", () => {
    it("should be compatible with prom-client type", () => {
      expectTypeOf<PromCounter>().toMatchTypeOf<Counter>();
    });

    it("should require to set labels if metric has defined labels", () => {
      const counter = {} as Counter<Labels>;

      expectTypeOf(counter.inc).toEqualTypeOf<(labels: Labels, value?: number | undefined) => void>();
    });

    it("should not require to set labels if metric has no labels", () => {
      const counter = {} as Counter;

      expectTypeOf(counter.inc).toEqualTypeOf<(value?: number | undefined) => void>();
    });
  });
});
