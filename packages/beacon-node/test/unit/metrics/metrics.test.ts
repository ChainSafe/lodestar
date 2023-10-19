import {describe, it, expect} from "vitest";
import {createMetricsTest} from "./utils.js";

describe("Metrics", () => {
  it("should get default metrics from register", async () => {
    const metrics = createMetricsTest();
    const metricsAsArray = metrics.register.getMetricsAsArray();
    const metricsAsText = await metrics.register.metrics();
    expect(metricsAsArray.length).toBeGreaterThan(0);
    expect(metricsAsText).not.toBe("");
  });
});
