import {vi} from "vitest";
import {GaugeExtra, Histogram, LabelsGeneric, MetricsRegisterExtra} from "@lodestar/utils";
import {Metrics, getMetrics} from "../../src/metrics.js";

function createFakeMetric() {
  return {
    inc: vi.fn(),
    dec: vi.fn(),
    set: vi.fn(),
    observe: vi.fn(),
    startTimer: vi.fn(() => () => 0),
    reset: vi.fn(),
    addCollect: vi.fn(),
  };
}

/** Validator metrics backed by spies, so tests can assert observed values without a registry */
export function createFakeMetrics(): Metrics {
  const register: MetricsRegisterExtra = {
    gauge: <Labels extends LabelsGeneric>() => createFakeMetric() as unknown as GaugeExtra<Labels>,
    histogram: <Labels extends LabelsGeneric>() => createFakeMetric() as unknown as Histogram<Labels>,
    counter: () => createFakeMetric(),
  };
  return getMetrics(register, {version: "test", commit: "test", network: "test"});
}
