import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {Method, Version, Encoding} from "../../../src/network/reqresp/types.js";
import {formatProtocolId, parseProtocolId} from "../../../src/network/reqresp/utils/index.js";
import {getCurrentAndNextFork} from "../../../src/network/forks.js";

describe("ReqResp protocolID parse / render", () => {
  const testCases: {
    method: Method;
    version: Version;
    encoding: Encoding;
    protocolId: string;
  }[] = [
    {
      method: Method.Status,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      protocolId: "/eth2/beacon_chain/req/status/1/ssz_snappy",
    },
    {
      method: Method.BeaconBlocksByRange,
      version: Version.V2,
      encoding: Encoding.SSZ_SNAPPY,
      protocolId: "/eth2/beacon_chain/req/beacon_blocks_by_range/2/ssz_snappy",
    },
  ];

  for (const {method, encoding, version, protocolId} of testCases) {
    it(`Should render ${protocolId}`, () => {
      expect(formatProtocolId(method, version, encoding)).to.equal(protocolId);
    });

    it(`Should parse ${protocolId}`, () => {
      expect(parseProtocolId(protocolId)).to.deep.equal({method, version, encoding});
    });
  }
});

describe("getCurrentAndNextFork", function () {
  const altairEpoch = config.forks.altair.epoch;
  afterEach(() => {
    config.forks.altair.epoch = altairEpoch;
  });

  it("should return no next fork if altair epoch is infinity", () => {
    config.forks.altair.epoch = Infinity;
    const {currentFork, nextFork} = getCurrentAndNextFork(config, 0);
    expect(currentFork.name).to.be.equal(ForkName.phase0);
    expect(nextFork).to.be.undefined;
  });

  it("should return altair as next fork", () => {
    config.forks.altair.epoch = 1000;
    let forks = getCurrentAndNextFork(config, 0);
    expect(forks.currentFork.name).to.be.equal(ForkName.phase0);
    if (forks.nextFork) {
      expect(forks.nextFork.name).to.be.equal(ForkName.altair);
    } else {
      expect.fail("No next fork");
    }

    forks = getCurrentAndNextFork(config, 1000);
    expect(forks.currentFork.name).to.be.equal(ForkName.altair);
    expect(forks.nextFork).to.be.undefined;
  });
});
