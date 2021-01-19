import Multiaddr from "multiaddr";
import {expect} from "chai";
import {createRpcProtocol, isLocalMultiAddr, parseProtocolId} from "../../../src/network";
import {Method, ReqRespEncoding} from "../../../src/constants";

describe("Test isLocalMultiAddr", () => {
  it("should return true for 127.0.0.1", () => {
    const multi0 = Multiaddr("/ip4/127.0.0.1/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.be.true;
  });

  it("should return false for 0.0.0.0", () => {
    const multi0 = Multiaddr("/ip4/0.0.0.0/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.be.false;
  });
});

describe("ReqResp protocolID parse / render", () => {
  const testCases: {
    method: Method;
    encoding: ReqRespEncoding;
    version: number;
    protocolId: string;
  }[] = [
    {
      method: Method.Status,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      version: 1,
      protocolId: "/eth2/beacon_chain/req/status/1/ssz_snappy",
    },
  ];

  for (const {method, encoding, version, protocolId} of testCases) {
    it(`Should render ${protocolId}`, () => {
      expect(createRpcProtocol(method, encoding, version)).to.equal(protocolId);
    });

    it(`Should parse  ${protocolId}`, () => {
      expect(parseProtocolId(protocolId)).to.deep.equal({method, encoding, version});
    });
  }
});
