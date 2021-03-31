import {expect} from "chai";
import {createMetrics} from "../../../src/metrics";

describe("Metrics", () => {
  it("should get default metrics from register", async () => {
    const metrics = createMetrics();
    const metricsAsArray = await metrics.register.getMetricsAsArray();
    const metricsAsText = await metrics.register.metrics();
    expect(metricsAsArray.length).to.be.gt(0);
    expect(metricsAsText).to.not.equal("");
  });
});
