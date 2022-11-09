import {expect} from "chai";
import {createMetricsTest} from "./utils.js";

describe("BeaconMetrics", () => {
  it("updated metrics should be reflected in the register", async () => {
    const metrics = createMetricsTest();
    const metricsAsArray = metrics.register.getMetricsAsArray();
    const metricsAsText = await metrics.register.metrics();

    // basic assumptions
    expect(metricsAsArray.length).to.be.gt(0);
    expect(metricsAsText).to.not.equal("");

    // check updating beacon-specific metrics
    await expect(metrics.register.getSingleMetricAsString("libp2p_peers")).eventually.include("libp2p_peers 0");
    metrics.peers.set(1);
    await expect(metrics.register.getSingleMetricAsString("libp2p_peers")).eventually.include("libp2p_peers 1");
    metrics.peers.set(20);
    await expect(metrics.register.getSingleMetricAsString("libp2p_peers")).eventually.include("libp2p_peers 20");
  });
});
