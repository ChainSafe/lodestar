import {expect} from "chai";
import {Metrics} from "../../../src/metrics";

describe("Metrics", () => {
  it("should get default metrics from registry", () => {
    const m = new Metrics({enabled: true, timeout: 5000, serverPort: 0, pushGateway: false});
    expect(m.registry.getMetricsAsArray().length).to.be.gt(0);
    expect(m.registry.metrics()).to.not.equal("");
    m.close();
  });
});
