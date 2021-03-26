import {expect} from "chai";
import {Metrics} from "../../../src/metrics";

describe("Metrics", () => {
  it("should get default metrics from registry", async () => {
    const m = new Metrics({enabled: true, timeout: 5000, serverPort: 0, pushGateway: false});
    const metricsAsArray = await m.registry.getMetricsAsArray();
    const metricsAsText = await m.registry.metrics();
    expect(metricsAsArray.length).to.be.gt(0);
    expect(metricsAsText).to.not.equal("");
  });
});
