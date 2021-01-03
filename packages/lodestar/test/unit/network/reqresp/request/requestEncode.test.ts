import {expect} from "chai";
import all from "it-all";
import pipe from "it-pipe";
import {toHexString} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/minimal";
import {RequestBody} from "@chainsafe/lodestar-types";
import {Method, ReqRespEncoding} from "../../../../../src/constants";
import {requestEncode} from "../../../../../src/network/reqresp/request/requestEncode";
import {sszSnappyPing} from "../encodingStrategies/sszSnappy/testData";

describe("network / reqresp / request / requestEncode", () => {
  const testCases: {
    id: string;
    method: Method;
    encoding: ReqRespEncoding;
    requestBody: RequestBody;
    chunks: Buffer[];
  }[] = [
    {
      id: "No body, should be ok",
      method: Method.Metadata,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      requestBody: null,
      chunks: [],
    },
    {
      id: "Regular request",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      requestBody: sszSnappyPing.body,
      chunks: sszSnappyPing.chunks,
    },
  ];

  for (const {id, method, encoding, requestBody, chunks} of testCases) {
    it(id, async () => {
      const encodedChunks = await pipe(requestEncode(config, method, encoding, requestBody), all);
      expect(encodedChunks.map(toHexString)).to.deep.equal(chunks.map(toHexString));
    });
  }
});
