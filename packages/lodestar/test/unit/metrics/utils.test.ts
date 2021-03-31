import {expect} from "chai";
import {Gauge, Registry} from "prom-client";
import {GaugeExtra} from "../../../src/metrics/utils/gauge";

type MetricValue = {
  value: number;
  labels: Record<string, string>;
};

describe("Metrics Gauge collect fn", () => {
  const name = "test_metric";
  const help = name;

  async function getMetric(register: Registry): Promise<MetricValue[]> {
    const metrics = await register.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === name);
    if (!metric) throw Error(`Metric ${name} not found`);
    return ((metric as unknown) as {values: MetricValue[]}).values;
  }

  it("Use no collect function", async () => {
    const register = new Registry();
    new Gauge({
      name,
      help,
      registers: [register],
    });

    expect(await getMetric(register)).to.deep.equal([{value: 0, labels: {}}]);
  });

  it("Use collect function in constructor", async () => {
    const num = 5;
    const register = new Registry();
    new Gauge({
      name,
      help,
      registers: [register],
      collect() {
        this.set(num);
      },
    });

    expect(await getMetric(register)).to.deep.equal([{value: num, labels: {}}]);
  });

  it("Override collect function", async () => {
    const num = 10;
    const register = new Registry();
    const gauge = new Gauge({
      name,
      help,
      registers: [register],
    });

    (gauge as Gauge<string> & {collect: () => void}).collect = function () {
      this.set(num);
    };

    expect(await getMetric(register)).to.deep.equal([{value: num, labels: {}}]);
  });

  it("Override collect function with GaugeCollectable", async () => {
    const num = 15;
    const register = new Registry();
    const gauge = new GaugeExtra({
      name,
      help,
      registers: [register],
    });

    gauge.addCollect((g) => g.set(num));

    expect(await getMetric(register)).to.deep.equal([{value: num, labels: {}}]);
  });
});
