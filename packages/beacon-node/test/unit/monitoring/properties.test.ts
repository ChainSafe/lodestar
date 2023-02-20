import {expect} from "chai";
import {Metrics} from "../../../src/metrics/index.js";
import {DynamicProperty, MetricProperty, StaticProperty} from "../../../src/monitoring/properties.js";
import {JsonType} from "../../../src/monitoring/types.js";
import {createMetricsTest} from "../metrics/utils.js";

describe("monitoring / properties", () => {
  const jsonKey = "test_key";
  const value = 1;

  describe("StaticProperty", () => {
    it("should return a json record with the configured key and value", () => {
      const staticProperty = new StaticProperty({jsonKey, value});

      const jsonRecord = staticProperty.getRecord();

      expect(jsonRecord.key).to.equal(jsonKey);
      expect(jsonRecord.value).to.equal(value);
    });
  });

  describe("DynamicProperty", () => {
    it("should return a json record with the configured key and return value of provider", () => {
      const dynamicProperty = new DynamicProperty({jsonKey, provider: () => value});

      const jsonRecord = dynamicProperty.getRecord();

      expect(jsonRecord.key).to.equal(jsonKey);
      expect(jsonRecord.value).to.equal(value);
    });
  });

  describe("MetricProperty", () => {
    let metrics: Metrics;

    before(() => {
      metrics = createMetricsTest();
    });

    it("should return a json record with the configured key and metric value", async () => {
      const peerCount = 50;
      metrics.peers.set(peerCount);

      const metricProperty = new MetricProperty({
        jsonKey,
        metricName: "libp2p_peers",
        jsonType: JsonType.Number,
        defaultValue: 0,
      });

      const jsonRecord = await metricProperty.getRecord(metrics.register);

      expect(jsonRecord.key).to.equal(jsonKey);
      expect(jsonRecord.value).to.equal(peerCount);
    });

    it("should return the default value if metric with name does not exist", async () => {
      const defaultValue = 10;

      const metricProperty = new MetricProperty({
        jsonKey,
        metricName: "does_not_exist",
        jsonType: JsonType.Number,
        defaultValue,
      });

      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(defaultValue);
    });

    it("should get the value from label instead of metric value if fromLabel is defined", async () => {
      const metricName = "static_metric";
      const labelName = "test_label";
      const labelValue = "test_value";

      metrics.register.static({name: metricName, help: "fromLabel test", value: {[labelName]: labelValue}});

      const metricProperty = new MetricProperty({
        jsonKey,
        metricName,
        fromLabel: labelName,
        jsonType: JsonType.String,
        defaultValue: "",
      });

      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(labelValue);
    });

    it("should get the value from metric with label if withLabel is defined", async () => {
      const metricName = "metric_with_labels";
      const labelName = "test_label_name";
      const labelValue = "test_label_value";
      const metricValue = 10;

      const metric = metrics.register.gauge({name: metricName, help: "withLabel test", labelNames: [labelName]});
      metric.set({[labelName]: "different_value"}, metricValue + 1);
      metric.set({[labelName]: labelValue}, metricValue);

      const metricProperty = new MetricProperty({
        jsonKey,
        metricName,
        withLabel: {name: labelName, value: labelValue},
        jsonType: JsonType.Number,
        defaultValue: 0,
      });

      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(metricValue);
    });

    it("should return the same value on consecutive calls if cacheResult is set to true", async () => {
      const metricName = "metric_test_caching";
      const initialValue = 10;

      const metric = metrics.register.gauge({name: metricName, help: "cacheResult test"});
      metric.set(initialValue);

      const metricProperty = new MetricProperty({
        jsonKey,
        metricName,
        jsonType: JsonType.Number,
        defaultValue: 0,
        cacheResult: true,
      });

      // initial call which will cache the result
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(initialValue);

      // set different value
      metric.set(initialValue + 1);

      // ensure consecutive calls still return initial value
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(initialValue);
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(initialValue);
    });

    it("should convert the metric value to a string if jsonType is JsonType.String", async () => {
      const metricName = "metric_test_string";

      const metric = metrics.register.gauge({name: metricName, help: "JsonType.String test"});

      const metricProperty = new MetricProperty({
        jsonKey,
        metricName,
        jsonType: JsonType.String,
        defaultValue: "",
      });

      metric.set(10);
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal("10");
    });

    it("should round the metric value to the nearest integer if jsonType is JsonType.Number", async () => {
      const metricName = "metric_test_number";

      const metric = metrics.register.gauge({name: metricName, help: "JsonType.Number test"});

      const metricProperty = new MetricProperty({
        jsonKey,
        metricName,
        jsonType: JsonType.Number,
        defaultValue: 0,
      });

      metric.set(1.49);
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(1);
    });

    it("should convert the metric value to a boolean if jsonType is JsonType.Boolean", async () => {
      const metricName = "metric_test_boolean";

      const metric = metrics.register.gauge({name: metricName, help: "JsonType.Boolean test"});

      const metricProperty = new MetricProperty({
        jsonKey,
        metricName,
        jsonType: JsonType.Boolean,
        defaultValue: false,
      });

      metric.set(0);
      // metric value of 0 should be converted to false
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(false);

      metric.set(1);
      // metric value > 0 should be converted to true
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(true);
    });

    it("should convert the metric value to true if the specified rangeValue is matched", async () => {
      const metricName = "metric_test_range_value";
      const rangeValue = 3;

      const metric = metrics.register.gauge({name: metricName, help: "rangeValue test"});

      const metricProperty = new MetricProperty({
        jsonKey,
        metricName,
        rangeValue,
        jsonType: JsonType.Boolean,
        defaultValue: false,
      });

      metric.set(rangeValue + 1);
      // value does not match range value and should be converted to false
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(false);

      metric.set(rangeValue);
      // value matches range value and should be converted to true
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(true);
    });

    it("should convert the metric value to true if value is greater than or equal to threshold", async () => {
      const metricName = "metric_test_threshold";
      const threshold = 2;

      const metric = metrics.register.gauge({name: metricName, help: "threshold test"});

      const metricProperty = new MetricProperty({
        jsonKey,
        metricName,
        threshold,
        jsonType: JsonType.Boolean,
        defaultValue: false,
      });

      metric.set(threshold - 1);
      // value is below threshold and should be converted to false
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(false);

      metric.set(threshold);
      // value is equal to threshold and should be converted to true
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(true);

      metric.set(threshold + 1);
      // value is greater than threshold and should be converted to true
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(true);
    });

    it("should apply the defined formatter to the metric value", async () => {
      const metricName = "metric_test_formatting";
      const metricValue = 10;

      const metric = metrics.register.gauge({name: metricName, help: "formatter test"});

      const metricProperty = new MetricProperty({
        jsonKey,
        metricName,
        jsonType: JsonType.String,
        formatter: (value) => `prefix_${value}`,
        defaultValue: "",
      });

      metric.set(metricValue);
      expect((await metricProperty.getRecord(metrics.register)).value).to.equal(`prefix_${metricValue}`);
    });
  });
});
