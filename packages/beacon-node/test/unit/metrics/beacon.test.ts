import {describe, it, expect} from "vitest";
import {createMetricsTest} from "./utils.js";

describe("BeaconMetrics", () => {
  it("updated metrics should be reflected in the register", async () => {
    const metrics = createMetricsTest();
    const metricsAsArray = metrics.register.getMetricsAsArray();
    const metricsAsText = await metrics.register.metrics();

    // basic assumptions
    expect(metricsAsArray.length).toBeGreaterThan(0);
    expect(metricsAsText).not.toBe("");

    // check updating beacon-specific metrics
    const headSlotName = "beacon_head_slot";
    await expect(metrics.register.getSingleMetricAsString(headSlotName)).resolves.toContain(`${headSlotName} 0`);
    metrics.headSlot.set(1);
    await expect(metrics.register.getSingleMetricAsString(headSlotName)).resolves.toContain(`${headSlotName} 1`);
    metrics.headSlot.set(20);
    await expect(metrics.register.getSingleMetricAsString(headSlotName)).resolves.toContain(`${headSlotName} 20`);
  });
});
