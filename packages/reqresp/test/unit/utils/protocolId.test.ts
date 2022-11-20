import {expect} from "chai";
import {Encoding, Protocol} from "../../../src/index.js";
import {formatProtocolID, parseProtocolID as reqrespParseProtocolID} from "../../../src/utils/index.js";

const protocolPrefix = "/eth2/beacon_chain/req";

function parseProtocolId(protocolId: string): Protocol {
  const result = reqrespParseProtocolID(protocolId);
  if (result.protocolPrefix !== protocolPrefix) {
    throw Error(`Unknown protocolId prefix: ${result.protocolPrefix}`);
  }

  return result;
}

describe("ReqResp protocolID parse / render", () => {
  const testCases: {
    method: string;
    version: number;
    encoding: Encoding;
    protocolId: string;
  }[] = [
    {
      method: "status",
      version: 1,
      encoding: Encoding.SSZ_SNAPPY,
      protocolId: "/eth2/beacon_chain/req/status/1/ssz_snappy",
    },
    {
      method: "beacon_blocks_by_range",
      version: 2,
      encoding: Encoding.SSZ_SNAPPY,
      protocolId: "/eth2/beacon_chain/req/beacon_blocks_by_range/2/ssz_snappy",
    },
  ];

  for (const {method, encoding, version, protocolId} of testCases) {
    it(`Should render ${protocolId}`, () => {
      expect(formatProtocolID(protocolPrefix, method, version, encoding)).to.equal(protocolId);
    });

    it(`Should parse ${protocolId}`, () => {
      expect(parseProtocolId(protocolId)).to.deep.equal({protocolPrefix, method, version, encoding});
    });
  }
});
