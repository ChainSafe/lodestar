import {expect} from "chai";
import {BeaconMetrics} from "../../../src/metrics";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";

describe("BeaconMetrics", () => {
  const logger: ILogger = new WinstonLogger();
  it("updated metrics should be reflected in the registry", async () => {
    const m = new BeaconMetrics({enabled: true, timeout: 5000, pushGateway: false, serverPort: 0}, {logger});
    await m.start();
    // basic assumptions
    expect(m.registry.getMetricsAsArray().length).to.be.gt(0);
    expect(m.registry.metrics()).to.not.equal("");
    // check updating beacon-specific metrics
    expect(m.registry.getSingleMetricAsString("beaconchain_peers").match(/beaconchain_peers 0/)).to.not.be.null;
    m.peers.set(1);
    expect(m.registry.getSingleMetricAsString("beaconchain_peers").match(/beaconchain_peers 1/)).to.not.be.null;
    m.peers.set(20);
    expect(m.registry.getSingleMetricAsString("beaconchain_peers").match(/beaconchain_peers 20/)).to.not.be.null;
    await m.stop();
  });
});
