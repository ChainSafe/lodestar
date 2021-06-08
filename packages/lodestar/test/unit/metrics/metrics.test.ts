import {expect} from "chai";
import {createMetricsTest} from "./utils";

describe("Metrics", () => {
  it("should get default metrics from register", async () => {
    const metrics = createMetricsTest();
    const metricsAsArray = await metrics.register.getMetricsAsArray();
    const metricsAsText = await metrics.register.metrics();
    expect(metricsAsArray.length).to.be.gt(0);
    expect(metricsAsText).to.not.equal("");
  });
});
