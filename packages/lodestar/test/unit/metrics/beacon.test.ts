import {expect} from "chai";
import {BeaconMetrics} from "../../../src/metrics";
import {ILogger, Logger} from "@chainsafe/lodestar-utils";

describe("BeaconMetrics", () => {
  const logger: ILogger = new Logger();
  it("updated metrics should be reflected in the registry", () => {
    const m = new BeaconMetrics({enabled: true, timeout: 5000, pushGateway: false, serverPort: 0}, {logger});
    // basic assumptions
    expect(m.registry.getMetricsAsArray().length).to.be.gt(0);
    expect(m.registry.metrics()).to.not.equal("");
    // check updating beacon-specific metrics
    expect(m.registry.getSingleMetricAsString("libp2p_peers").match(/libp2p_peers 0/)).to.not.be.null;
    m.peers.set(1);
    expect(m.registry.getSingleMetricAsString("libp2p_peers").match(/libp2p_peers 1/)).to.not.be.null;
    m.peers.set(20);
    expect(m.registry.getSingleMetricAsString("libp2p_peers").match(/libp2p_peers 20/)).to.not.be.null;
    m.close();
  });
});
