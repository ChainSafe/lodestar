import {expect} from "chai";
import {createMetricsTest} from "./utils";

describe("BeaconMetrics", () => {
  it("updated metrics should be reflected in the register", async () => {
    const metrics = createMetricsTest();
    const metricsAsArray = await metrics.register.getMetricsAsArray();
    const metricsAsText = await metrics.register.metrics();

    // basic assumptions
    expect(metricsAsArray.length).to.be.gt(0);
    expect(metricsAsText).to.not.equal("");

    // check updating beacon-specific metrics
    expect((await metrics.register.getSingleMetricAsString("libp2p_peers")).includes("libp2p_peers 0"));
    metrics.peers.set(1);
    expect((await metrics.register.getSingleMetricAsString("libp2p_peers")).includes("libp2p_peers 1"));
    metrics.peers.set(20);
    expect((await metrics.register.getSingleMetricAsString("libp2p_peers")).includes("libp2p_peers 20"));
  });
});
