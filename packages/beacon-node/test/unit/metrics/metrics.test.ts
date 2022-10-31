import {expect} from "chai";
import {createMetricsTest} from "./utils.js";

describe("Metrics", () => {
  it("should get default metrics from register", async () => {
    const metrics = createMetricsTest();
    const metricsAsArray = metrics.register.getMetricsAsArray();
    const metricsAsText = await metrics.register.metrics();
    expect(metricsAsArray.length).to.be.gt(0);
    expect(metricsAsText).to.not.equal("");
  });
});
