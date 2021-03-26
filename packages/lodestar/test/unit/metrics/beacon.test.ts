import {expect} from "chai";
import {BeaconMetrics} from "../../../src/metrics";
import {testLogger} from "../../utils/logger";

describe("BeaconMetrics", () => {
  const logger = testLogger();
  it("updated metrics should be reflected in the registry", async () => {
    const m = new BeaconMetrics({enabled: true, timeout: 5000, pushGateway: false, serverPort: 0}, {logger});
    const metricsAsArray = await m.registry.getMetricsAsArray();
    const metricsAsText = await m.registry.metrics();

    // basic assumptions
    expect(metricsAsArray.length).to.be.gt(0);
    expect(metricsAsText).to.not.equal("");

    // check updating beacon-specific metrics
    expect((await m.registry.getSingleMetricAsString("libp2p_peers")).includes("libp2p_peers 0"));
    m.peers.set(1);
    expect((await m.registry.getSingleMetricAsString("libp2p_peers")).includes("libp2p_peers 1"));
    m.peers.set(20);
    expect((await m.registry.getSingleMetricAsString("libp2p_peers")).includes("libp2p_peers 20"));
  });
});
